// src/lib/workflow/engine.ts
// Workflow Engine - Core workflow processing logic
// P2-19: Extended with PARALLEL and QUORUM approval modes

import { db } from "@/lib/db";
import { resolveApprover } from "./approver-resolver";
import { evaluateCondition, type Condition } from "./condition-evaluator";
import type {
  RequestStatus,
  ApprovalStatus,
  ApprovalMode,
  WorkflowStep as PrismaWorkflowStep,
} from ".prisma/hrm-unified-client";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface StartWorkflowInput {
  tenantId: string;
  workflowCode: string;
  referenceType: string;
  referenceId: string;
  requesterId: string;
  context?: Record<string, unknown>;
}

export interface WorkflowInstance {
  id: string;
  tenantId: string;
  definitionId: string;
  referenceType: string;
  referenceId: string;
  requesterId: string;
  status: RequestStatus;
  currentStepOrder: number;
}

// ═══════════════════════════════════════════════════════════════
// Start Workflow
// ═══════════════════════════════════════════════════════════════

/**
 * Start a new workflow instance
 */
export async function startWorkflow(
  input: StartWorkflowInput,
): Promise<WorkflowInstance> {
  const {
    tenantId,
    workflowCode,
    referenceType,
    referenceId,
    requesterId,
    context = {},
  } = input;

  // 1. Get workflow definition
  const definition = await db.workflowDefinition.findUnique({
    where: { tenantId_code: { tenantId, code: workflowCode } },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
      },
    },
  });

  if (!definition || !definition.isActive) {
    throw new Error("Quy trình không tồn tại hoặc đã bị vô hiệu hóa");
  }

  // 2. Create workflow instance (store context for subsequent steps)
  const instance = await db.workflowInstance.create({
    data: {
      tenantId,
      definitionId: definition.id,
      referenceType,
      referenceId,
      requesterId,
      status: "PENDING",
      currentStepOrder: 1,
      context: context as any,
    },
  });

  // 3. Find first applicable step
  const firstStep = findNextStep(definition.steps, 1, context);

  if (!firstStep) {
    // No steps required - auto approve
    await completeWorkflow(instance.id, "APPROVED");
    return instance;
  }

  // 4. Create approval step(s) based on approval mode
  await createApprovalSteps(
    tenantId,
    instance.id,
    firstStep,
    requesterId,
    context,
  );

  return instance;
}

// ═══════════════════════════════════════════════════════════════
// Process Approval
// ═══════════════════════════════════════════════════════════════

/**
 * Process an approval decision (approve or reject)
 * P2-19: Now handles PARALLEL and QUORUM modes
 */
export async function processApproval(
  approvalId: string,
  userId: string,
  action: "APPROVED" | "REJECTED",
  comments?: string,
): Promise<void> {
  // Get approval with related data
  const approval = await db.approvalStep.findUnique({
    where: { id: approvalId },
    include: {
      instance: {
        include: {
          definition: {
            include: {
              steps: {
                orderBy: { stepOrder: "asc" },
              },
            },
          },
        },
      },
      step: true,
    },
  });

  if (!approval) {
    throw new Error("Không tìm thấy yêu cầu duyệt");
  }

  if (approval.status !== "PENDING") {
    throw new Error("Yêu cầu này đã được xử lý");
  }

  if (approval.approverId !== userId) {
    throw new Error("Bạn không có quyền duyệt yêu cầu này");
  }

  // Update this approval step
  await db.approvalStep.update({
    where: { id: approvalId },
    data: {
      status: action,
      respondedAt: new Date(),
      comments,
    },
  });

  const approvalMode = approval.step.approvalMode as ApprovalMode;
  const requiredApprovals = approval.step.requiredApprovals;

  // ─── SEQUENTIAL mode (original behavior) ───
  if (approvalMode === "SEQUENTIAL") {
    if (action === "REJECTED") {
      await completeWorkflow(approval.instanceId, "REJECTED");
      return;
    }
    await advanceToNextStep(approval);
    return;
  }

  // ─── PARALLEL / QUORUM mode ───
  // Get all approval steps for this workflow step
  const siblingApprovals = await db.approvalStep.findMany({
    where: {
      instanceId: approval.instanceId,
      stepId: approval.stepId,
    },
  });

  const approved = siblingApprovals.filter((a) => a.status === "APPROVED");
  const rejected = siblingApprovals.filter((a) => a.status === "REJECTED");
  const pending = siblingApprovals.filter((a) => a.status === "PENDING");
  const total = siblingApprovals.length;

  if (approvalMode === "PARALLEL") {
    // ALL must approve; any rejection = workflow rejected
    if (action === "REJECTED") {
      // Skip remaining pending approvals
      await skipPendingApprovals(approval.instanceId, approval.stepId);
      await completeWorkflow(approval.instanceId, "REJECTED");
      return;
    }
    if (approved.length === total) {
      // All approved - advance
      await advanceToNextStep(approval);
    }
    // Otherwise, wait for remaining approvals
    return;
  }

  if (approvalMode === "QUORUM") {
    // Need requiredApprovals approvals; too many rejections = rejected
    if (approved.length >= requiredApprovals) {
      // Quorum reached - skip remaining and advance
      await skipPendingApprovals(approval.instanceId, approval.stepId);
      await advanceToNextStep(approval);
      return;
    }

    const maxPossibleApprovals = approved.length + pending.length;
    if (maxPossibleApprovals < requiredApprovals) {
      // Cannot reach quorum anymore - reject
      await skipPendingApprovals(approval.instanceId, approval.stepId);
      await completeWorkflow(approval.instanceId, "REJECTED");
      return;
    }
    // Otherwise, still waiting for more votes
    return;
  }
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Skip all pending approval steps for a given workflow step
 */
async function skipPendingApprovals(
  instanceId: string,
  stepId: string,
): Promise<void> {
  await db.approvalStep.updateMany({
    where: {
      instanceId,
      stepId,
      status: "PENDING",
    },
    data: {
      status: "SKIPPED",
    },
  });
}

/**
 * Advance workflow to the next step after current step is done
 */
async function advanceToNextStep(approval: {
  instanceId: string;
  instance: {
    tenantId: string;
    requesterId: string;
    context: unknown;
    definition: {
      steps: PrismaWorkflowStep[];
    };
  };
  step: { stepOrder: number };
}): Promise<void> {
  const context = (approval.instance.context as Record<string, unknown>) || {};

  const nextStep = findNextStep(
    approval.instance.definition.steps,
    approval.step.stepOrder + 1,
    context,
  );

  if (!nextStep) {
    // All steps completed - workflow approved
    await completeWorkflow(approval.instanceId, "APPROVED");
    return;
  }

  // Update instance and create next approval step(s)
  await db.workflowInstance.update({
    where: { id: approval.instanceId },
    data: { currentStepOrder: nextStep.stepOrder },
  });

  await createApprovalSteps(
    approval.instance.tenantId,
    approval.instanceId,
    nextStep,
    approval.instance.requesterId,
    context,
  );
}

/**
 * Find the next applicable step based on conditions
 */
function findNextStep(
  steps: PrismaWorkflowStep[],
  fromOrder: number,
  context: Record<string, unknown>,
): PrismaWorkflowStep | null {
  for (const step of steps.filter((s) => s.stepOrder >= fromOrder)) {
    // Check conditions if present
    if (step.conditions) {
      const conditions = step.conditions as unknown as Condition | Condition[];
      if (!evaluateCondition(conditions, context)) {
        continue; // Skip this step
      }
    }
    return step;
  }
  return null;
}

/**
 * Create approval step(s) for a workflow step.
 * P2-19: Supports SEQUENTIAL (single), PARALLEL (all), and QUORUM (all) modes.
 */
async function createApprovalSteps(
  tenantId: string,
  instanceId: string,
  step: PrismaWorkflowStep,
  requesterId: string,
  context: Record<string, unknown>,
): Promise<void> {
  const approvalMode = step.approvalMode as ApprovalMode;

  // Calculate SLA due date
  const dueAt = step.slaHours
    ? new Date(Date.now() + step.slaHours * 60 * 60 * 1000)
    : null;

  if (approvalMode === "SEQUENTIAL") {
    // Original behavior: single approver
    const approverInfo = await resolveApprover(
      tenantId,
      {
        approverType: step.approverType,
        specificUserId: step.specificUserId,
        specificRole: step.specificRole,
      },
      requesterId,
      context,
    );

    await createSingleApproval(
      tenantId,
      instanceId,
      step.id,
      approverInfo,
      dueAt,
    );
    return;
  }

  // PARALLEL or QUORUM: create approvals for all specified approvers
  const approverIds = step.approverUserIds || [];

  if (approverIds.length === 0) {
    // Fallback: resolve single approver if no explicit list
    const approverInfo = await resolveApprover(
      tenantId,
      {
        approverType: step.approverType,
        specificUserId: step.specificUserId,
        specificRole: step.specificRole,
      },
      requesterId,
      context,
    );
    await createSingleApproval(
      tenantId,
      instanceId,
      step.id,
      approverInfo,
      dueAt,
    );
    return;
  }

  // Create one approval step per approver
  for (const approverId of approverIds) {
    await createSingleApproval(
      tenantId,
      instanceId,
      step.id,
      { approverId },
      dueAt,
    );
  }
}

/**
 * Create a single approval step and send notification
 */
async function createSingleApproval(
  tenantId: string,
  instanceId: string,
  stepId: string,
  approverInfo: { approverId: string; delegatedFromId?: string },
  dueAt: Date | null,
): Promise<void> {
  const approval = await db.approvalStep.create({
    data: {
      instanceId,
      stepId,
      approverId: approverInfo.approverId,
      delegatedFromId: approverInfo.delegatedFromId,
      status: "PENDING",
      dueAt,
    },
  });

  // Send notification
  await db.notification.create({
    data: {
      tenantId,
      userId: approverInfo.approverId,
      type: "PENDING_APPROVAL",
      title: "Yêu cầu cần duyệt",
      message: "Bạn có yêu cầu mới cần xử lý",
      referenceType: "APPROVAL",
      referenceId: approval.id,
      actionUrl: `/approvals/${approval.id}`,
    },
  });
}

/**
 * Complete a workflow with final status
 */
async function completeWorkflow(
  instanceId: string,
  finalStatus: "APPROVED" | "REJECTED",
): Promise<void> {
  const instance = await db.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status: finalStatus as RequestStatus,
      finalStatus: finalStatus as ApprovalStatus,
      completedAt: new Date(),
    },
  });

  // Execute post-completion actions
  await executePostActions(instance);

  // Notify requester
  await db.notification.create({
    data: {
      tenantId: instance.tenantId,
      userId: instance.requesterId,
      type:
        finalStatus === "APPROVED" ? "REQUEST_APPROVED" : "REQUEST_REJECTED",
      title:
        finalStatus === "APPROVED"
          ? "Yêu cầu được duyệt"
          : "Yêu cầu bị từ chối",
      message: `Yêu cầu của bạn đã ${finalStatus === "APPROVED" ? "được duyệt" : "bị từ chối"}`,
      referenceType: instance.referenceType,
      referenceId: instance.referenceId,
    },
  });
}

/**
 * Execute post-workflow completion actions
 */
async function executePostActions(instance: {
  id: string;
  tenantId: string;
  referenceType: string;
  referenceId: string;
  finalStatus: ApprovalStatus | null;
}): Promise<void> {
  // Handle leave request completion
  if (instance.referenceType === "LEAVE_REQUEST") {
    const request = await db.leaveRequest.findUnique({
      where: { id: instance.referenceId },
    });

    if (!request) return;

    if (instance.finalStatus === "APPROVED") {
      // Update leave request status
      await db.leaveRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED" },
      });

      // Update balance: move from pending to used
      const year = new Date(request.startDate).getFullYear();
      const balance = await db.leaveBalance.findFirst({
        where: {
          tenantId: request.tenantId,
          employeeId: request.employeeId,
          policyId: request.policyId,
          year,
        },
      });

      if (balance) {
        const newUsed = Number(balance.used) + Number(request.totalDays);
        const newPending = Number(balance.pending) - Number(request.totalDays);
        const newAvailable =
          Number(balance.entitlement) +
          Number(balance.carryOver) +
          Number(balance.adjustment) -
          newUsed -
          newPending;

        await db.leaveBalance.update({
          where: { id: balance.id },
          data: {
            used: newUsed,
            pending: Math.max(0, newPending),
            available: newAvailable,
          },
        });
      }
    } else {
      // Update leave request status
      await db.leaveRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED" },
      });

      // Return pending days to available
      const year = new Date(request.startDate).getFullYear();
      const balance = await db.leaveBalance.findFirst({
        where: {
          tenantId: request.tenantId,
          employeeId: request.employeeId,
          policyId: request.policyId,
          year,
        },
      });

      if (balance) {
        const newPending = Number(balance.pending) - Number(request.totalDays);
        const newAvailable =
          Number(balance.entitlement) +
          Number(balance.carryOver) +
          Number(balance.adjustment) -
          Number(balance.used) -
          newPending;

        await db.leaveBalance.update({
          where: { id: balance.id },
          data: {
            pending: Math.max(0, newPending),
            available: newAvailable,
          },
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Cancel Workflow
// ═══════════════════════════════════════════════════════════════

/**
 * Cancel a workflow instance
 */
export async function cancelWorkflow(instanceId: string): Promise<void> {
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
  });

  if (!instance) {
    throw new Error("Không tìm thấy workflow");
  }

  if (instance.status !== "PENDING") {
    throw new Error("Chỉ có thể hủy workflow đang chờ xử lý");
  }

  await db.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
    },
  });

  // Mark all pending approval steps as skipped
  await db.approvalStep.updateMany({
    where: {
      instanceId,
      status: "PENDING",
    },
    data: {
      status: "SKIPPED",
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Get Workflow Status
// ═══════════════════════════════════════════════════════════════

/**
 * Get current workflow status with approval history
 */
export async function getWorkflowStatus(instanceId: string) {
  const instance = await db.workflowInstance.findUnique({
    where: { id: instanceId },
    include: {
      definition: {
        include: {
          steps: {
            orderBy: { stepOrder: "asc" },
          },
        },
      },
      approvalSteps: {
        include: {
          step: true,
          approver: {
            select: { id: true, name: true, email: true },
          },
          delegatedFrom: {
            select: { id: true, name: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return instance;
}
