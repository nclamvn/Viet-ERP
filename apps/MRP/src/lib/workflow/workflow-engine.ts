/**
 * Workflow Engine - Core logic for approval workflow automation
 * Handles workflow lifecycle: start, approve, reject, escalate, cancel
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  WorkflowEntityType,
  WorkflowStatus,
  ApprovalDecision,
  NotificationChannel,
  Prisma,
} from ".prisma/mrp-client";

// Types for workflow operations
export interface StartWorkflowParams {
  workflowCode: string;
  entityType: WorkflowEntityType;
  entityId: string;
  initiatedBy: string;
  contextData?: Record<string, unknown>;
}

export interface ApproveStepParams {
  instanceId: string;
  approverId: string;
  comments?: string;
}

export interface RejectStepParams {
  instanceId: string;
  approverId: string;
  comments: string; // Required for rejection
}

export interface DelegateParams {
  approvalId: string;
  delegatedBy: string;
  delegateTo: string;
  reason: string;
}

export interface WorkflowResult {
  success: boolean;
  instanceId?: string;
  error?: string;
  status?: WorkflowStatus;
}

/**
 * Workflow Engine class - manages all workflow operations
 */
export class WorkflowEngine {
  /**
   * Start a new workflow instance for an entity
   */
  async startWorkflow(params: StartWorkflowParams): Promise<WorkflowResult> {
    const { workflowCode, entityType, entityId, initiatedBy, contextData } =
      params;

    try {
      // Find the workflow definition
      const workflow = await prisma.workflowDefinition.findFirst({
        where: {
          code: workflowCode,
          entityType,
          isActive: true,
        },
        include: {
          steps: {
            orderBy: { stepNumber: "asc" },
          },
        },
      });

      if (!workflow) {
        return {
          success: false,
          error: `Workflow "${workflowCode}" not found or inactive`,
        };
      }

      if (workflow.steps.length === 0) {
        return { success: false, error: "Workflow has no steps defined" };
      }

      // Check trigger conditions if defined
      if (workflow.triggerConditions && contextData) {
        const shouldTrigger = this.evaluateConditions(
          workflow.triggerConditions as Record<string, unknown>,
          contextData,
        );
        if (!shouldTrigger) {
          return { success: false, error: "Trigger conditions not met" };
        }
      }

      // Calculate due date based on SLA
      const dueDate = workflow.defaultSlaHours
        ? new Date(Date.now() + workflow.defaultSlaHours * 60 * 60 * 1000)
        : undefined;

      // Create workflow instance
      const instance = await prisma.workflowInstance.create({
        data: {
          workflowId: workflow.id,
          entityType,
          entityId,
          status: "PENDING",
          currentStepNumber: 1,
          contextData: (contextData || {}) as Prisma.InputJsonValue,
          initiatedBy,
          dueDate,
        },
      });

      // Create first approval request
      const firstStep = workflow.steps[0];
      const approver = await this.resolveApprover(
        firstStep,
        initiatedBy,
        contextData,
      );

      if (approver) {
        const stepDueDate = firstStep.slaHours
          ? new Date(Date.now() + firstStep.slaHours * 60 * 60 * 1000)
          : undefined;

        await prisma.workflowApproval.create({
          data: {
            instanceId: instance.id,
            stepId: firstStep.id,
            approverId: approver,
            decision: "PENDING",
            dueDate: stepDueDate,
          },
        });

        // Send notification
        await this.sendNotification({
          instanceId: instance.id,
          recipientId: approver,
          type: "APPROVAL_REQUEST",
          title: `Approval Required: ${workflow.name}`,
          message: `You have a new approval request for ${entityType} ${entityId}`,
          actionUrl: `/approvals/${instance.id}`,
        });
      }

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId: instance.id,
          action: "STARTED",
          stepNumber: 1,
          performedBy: initiatedBy,
          newStatus: "PENDING",
          metadata: { workflowCode, entityId },
        },
      });

      return { success: true, instanceId: instance.id, status: "PENDING" };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "start" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Approve a workflow step
   */
  async approveStep(params: ApproveStepParams): Promise<WorkflowResult> {
    const { instanceId, approverId, comments } = params;

    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id: instanceId },
        include: {
          workflow: {
            include: {
              steps: { orderBy: { stepNumber: "asc" } },
            },
          },
          approvals: {
            where: {
              approverId,
              decision: "PENDING",
            },
          },
        },
      });

      if (!instance) {
        return { success: false, error: "Workflow instance not found" };
      }

      if (instance.status !== "PENDING" && instance.status !== "IN_PROGRESS") {
        return {
          success: false,
          error: `Cannot approve workflow in ${instance.status} status`,
        };
      }

      const pendingApproval = instance.approvals[0];
      if (!pendingApproval) {
        return {
          success: false,
          error: "No pending approval found for this user",
        };
      }

      // Update approval decision
      await prisma.workflowApproval.update({
        where: { id: pendingApproval.id },
        data: {
          decision: "APPROVED",
          comments,
          respondedAt: new Date(),
        },
      });

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId,
          action: "APPROVED",
          stepNumber: instance.currentStepNumber,
          performedBy: approverId,
          previousStatus: instance.status,
          newStatus: "IN_PROGRESS",
          comments,
        },
      });

      // Check if there are more steps
      const currentStep = instance.workflow.steps.find(
        (s) => s.stepNumber === instance.currentStepNumber,
      );
      const nextStepNumber =
        currentStep?.nextStepOnApprove || instance.currentStepNumber + 1;
      const nextStep = instance.workflow.steps.find(
        (s) => s.stepNumber === nextStepNumber,
      );

      if (nextStep) {
        // Move to next step
        await prisma.workflowInstance.update({
          where: { id: instanceId },
          data: {
            currentStepNumber: nextStepNumber,
            status: "IN_PROGRESS",
          },
        });

        // Create next approval
        const nextApprover = await this.resolveApprover(
          nextStep,
          instance.initiatedBy,
          instance.contextData as Record<string, unknown>,
        );

        if (nextApprover) {
          const stepDueDate = nextStep.slaHours
            ? new Date(Date.now() + nextStep.slaHours * 60 * 60 * 1000)
            : undefined;

          await prisma.workflowApproval.create({
            data: {
              instanceId,
              stepId: nextStep.id,
              approverId: nextApprover,
              decision: "PENDING",
              dueDate: stepDueDate,
            },
          });

          await this.sendNotification({
            instanceId,
            recipientId: nextApprover,
            type: "APPROVAL_REQUEST",
            title: `Approval Required: ${instance.workflow.name}`,
            message: `Step ${nextStepNumber}: ${nextStep.name}`,
            actionUrl: `/approvals/${instanceId}`,
          });
        }

        return { success: true, instanceId, status: "IN_PROGRESS" };
      } else {
        // Workflow completed
        await prisma.workflowInstance.update({
          where: { id: instanceId },
          data: {
            status: "APPROVED",
            finalDecision: "APPROVED",
            completedAt: new Date(),
          },
        });

        // Notify initiator
        await this.sendNotification({
          instanceId,
          recipientId: instance.initiatedBy,
          type: "COMPLETED",
          title: `Workflow Approved: ${instance.workflow.name}`,
          message: `Your ${instance.entityType} has been approved`,
          actionUrl: `/approvals/${instanceId}`,
        });

        return { success: true, instanceId, status: "APPROVED" };
      }
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "approve" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Reject a workflow step
   */
  async rejectStep(params: RejectStepParams): Promise<WorkflowResult> {
    const { instanceId, approverId, comments } = params;

    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id: instanceId },
        include: {
          workflow: true,
          approvals: {
            where: {
              approverId,
              decision: "PENDING",
            },
          },
        },
      });

      if (!instance) {
        return { success: false, error: "Workflow instance not found" };
      }

      if (instance.status !== "PENDING" && instance.status !== "IN_PROGRESS") {
        return {
          success: false,
          error: `Cannot reject workflow in ${instance.status} status`,
        };
      }

      const pendingApproval = instance.approvals[0];
      if (!pendingApproval) {
        return {
          success: false,
          error: "No pending approval found for this user",
        };
      }

      // Update approval decision
      await prisma.workflowApproval.update({
        where: { id: pendingApproval.id },
        data: {
          decision: "REJECTED",
          comments,
          respondedAt: new Date(),
        },
      });

      // Update instance status
      await prisma.workflowInstance.update({
        where: { id: instanceId },
        data: {
          status: "REJECTED",
          finalDecision: "REJECTED",
          finalComments: comments,
          completedAt: new Date(),
        },
      });

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId,
          action: "REJECTED",
          stepNumber: instance.currentStepNumber,
          performedBy: approverId,
          previousStatus: instance.status,
          newStatus: "REJECTED",
          comments,
        },
      });

      // Notify initiator
      await this.sendNotification({
        instanceId,
        recipientId: instance.initiatedBy,
        type: "REJECTED",
        title: `Workflow Rejected: ${instance.workflow.name}`,
        message: `Your ${instance.entityType} has been rejected. Reason: ${comments}`,
        actionUrl: `/approvals/${instanceId}`,
      });

      return { success: true, instanceId, status: "REJECTED" };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "reject" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Escalate an overdue workflow step
   */
  async escalateStep(
    instanceId: string,
    reason: string,
    escalatedBy: string,
  ): Promise<WorkflowResult> {
    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id: instanceId },
        include: {
          workflow: {
            include: {
              steps: true,
            },
          },
          approvals: {
            where: { decision: "PENDING" },
            include: { step: true },
          },
        },
      });

      if (!instance) {
        return { success: false, error: "Workflow instance not found" };
      }

      const pendingApproval = instance.approvals[0];
      if (!pendingApproval) {
        return { success: false, error: "No pending approval to escalate" };
      }

      const step = pendingApproval.step;
      const escalateTo = step.escalateTo;

      if (!escalateTo) {
        return {
          success: false,
          error: "No escalation target defined for this step",
        };
      }

      // Update current approval
      await prisma.workflowApproval.update({
        where: { id: pendingApproval.id },
        data: {
          decision: "ESCALATED",
          respondedAt: new Date(),
        },
      });

      // Create new approval for escalation target
      await prisma.workflowApproval.create({
        data: {
          instanceId,
          stepId: step.id,
          approverId: escalateTo,
          decision: "PENDING",
          dueDate: step.slaHours
            ? new Date(Date.now() + step.slaHours * 60 * 60 * 1000)
            : undefined,
        },
      });

      // Update instance status
      await prisma.workflowInstance.update({
        where: { id: instanceId },
        data: { status: "ESCALATED" },
      });

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId,
          action: "ESCALATED",
          stepNumber: instance.currentStepNumber,
          performedBy: escalatedBy,
          previousStatus: instance.status,
          newStatus: "ESCALATED",
          comments: reason,
          metadata: {
            escalatedFrom: pendingApproval.approverId,
            escalatedTo: escalateTo,
          },
        },
      });

      // Notify new approver
      await this.sendNotification({
        instanceId,
        recipientId: escalateTo,
        type: "ESCALATION",
        title: `Escalated Approval: ${instance.workflow.name}`,
        message: `An approval has been escalated to you. Reason: ${reason}`,
        actionUrl: `/approvals/${instanceId}`,
      });

      return { success: true, instanceId, status: "ESCALATED" };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "escalate" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Cancel a workflow instance
   */
  async cancelWorkflow(
    instanceId: string,
    cancelledBy: string,
    reason: string,
  ): Promise<WorkflowResult> {
    try {
      const instance = await prisma.workflowInstance.findUnique({
        where: { id: instanceId },
      });

      if (!instance) {
        return { success: false, error: "Workflow instance not found" };
      }

      if (instance.status === "APPROVED" || instance.status === "REJECTED") {
        return { success: false, error: "Cannot cancel completed workflow" };
      }

      // Update instance
      await prisma.workflowInstance.update({
        where: { id: instanceId },
        data: {
          status: "CANCELLED",
          finalComments: reason,
          completedAt: new Date(),
        },
      });

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId,
          action: "CANCELLED",
          stepNumber: instance.currentStepNumber,
          performedBy: cancelledBy,
          previousStatus: instance.status,
          newStatus: "CANCELLED",
          comments: reason,
        },
      });

      return { success: true, instanceId, status: "CANCELLED" };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "cancel" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Delegate an approval to another user
   */
  async delegateApproval(params: DelegateParams): Promise<WorkflowResult> {
    const { approvalId, delegatedBy, delegateTo, reason } = params;

    try {
      const approval = await prisma.workflowApproval.findUnique({
        where: { id: approvalId },
        include: { instance: true, step: true },
      });

      if (!approval) {
        return { success: false, error: "Approval not found" };
      }

      if (approval.approverId !== delegatedBy) {
        return {
          success: false,
          error: "Only the assigned approver can delegate",
        };
      }

      if (approval.decision !== "PENDING") {
        return { success: false, error: "Can only delegate pending approvals" };
      }

      // Update approval
      await prisma.workflowApproval.update({
        where: { id: approvalId },
        data: {
          decision: "DELEGATED",
          delegatedTo: delegateTo,
          delegationReason: reason,
          respondedAt: new Date(),
        },
      });

      // Create new approval for delegate
      await prisma.workflowApproval.create({
        data: {
          instanceId: approval.instanceId,
          stepId: approval.stepId,
          approverId: delegateTo,
          decision: "PENDING",
          dueDate: approval.dueDate,
        },
      });

      // Record history
      await prisma.workflowHistory.create({
        data: {
          instanceId: approval.instanceId,
          action: "DELEGATED",
          stepNumber: approval.instance.currentStepNumber,
          performedBy: delegatedBy,
          comments: reason,
          metadata: { delegatedFrom: delegatedBy, delegatedTo: delegateTo },
        },
      });

      // Notify delegate
      await this.sendNotification({
        instanceId: approval.instanceId,
        recipientId: delegateTo,
        type: "APPROVAL_REQUEST",
        title: `Delegated Approval: ${approval.step.name}`,
        message: `An approval has been delegated to you by another user`,
        actionUrl: `/approvals/${approval.instanceId}`,
      });

      return { success: true, instanceId: approval.instanceId };
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "delegate" },
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get pending approvals for a user
   */
  async getPendingApprovals(userId: string) {
    return prisma.workflowApproval.findMany({
      where: {
        approverId: userId,
        decision: "PENDING",
      },
      include: {
        instance: {
          include: {
            workflow: true,
          },
        },
        step: true,
      },
      orderBy: {
        requestedAt: "asc",
      },
    });
  }

  /**
   * Get workflow instance details
   */
  async getWorkflowInstance(instanceId: string) {
    return prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: {
        workflow: {
          include: {
            steps: { orderBy: { stepNumber: "asc" } },
          },
        },
        approvals: {
          include: {
            approver: { select: { id: true, name: true, email: true } },
            step: true,
          },
          orderBy: { requestedAt: "asc" },
        },
        history: {
          include: {
            performer: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        initiatedByUser: { select: { id: true, name: true, email: true } },
      },
    });
  }

  // Helper: Resolve approver based on step configuration
  private async resolveApprover(
    step: {
      approverRole?: string | null;
      approverUserId?: string | null;
      approverCondition?: unknown;
    },
    initiatorId: string,
    contextData?: Record<string, unknown>,
  ): Promise<string | null> {
    // Direct user assignment
    if (step.approverUserId) {
      return step.approverUserId;
    }

    // Role-based assignment
    if (step.approverRole) {
      const user = await prisma.user.findFirst({
        where: {
          role: step.approverRole,
          status: "active",
          id: { not: initiatorId }, // Don't assign to initiator
        },
        select: { id: true },
      });
      return user?.id || null;
    }

    // Conditional assignment (simplified)
    if (step.approverCondition && contextData) {
      const condition = step.approverCondition as Record<string, string>;
      if (condition.department === "same_as_requester") {
        // Would need department logic here
      }
    }

    return null;
  }

  // Helper: Evaluate trigger conditions
  private evaluateConditions(
    conditions: Record<string, unknown>,
    data: Record<string, unknown>,
  ): boolean {
    for (const [key, condition] of Object.entries(conditions)) {
      if (key.endsWith("_gt")) {
        const field = key.replace("_gt", "");
        if ((data[field] as number) <= (condition as number)) return false;
      } else if (key.endsWith("_lt")) {
        const field = key.replace("_lt", "");
        if ((data[field] as number) >= (condition as number)) return false;
      } else if (key.endsWith("_eq")) {
        const field = key.replace("_eq", "");
        if (data[field] !== condition) return false;
      } else {
        if (data[key] !== condition) return false;
      }
    }
    return true;
  }

  // Helper: Send notification
  private async sendNotification(params: {
    instanceId: string;
    recipientId: string;
    type: string;
    title: string;
    message: string;
    actionUrl?: string;
  }) {
    try {
      await prisma.workflowNotification.create({
        data: {
          instanceId: params.instanceId,
          recipientId: params.recipientId,
          type: params.type,
          channel: "IN_APP",
          title: params.title,
          message: params.message,
          actionUrl: params.actionUrl,
          sentAt: new Date(),
          deliveryStatus: "sent",
        },
      });
    } catch (error) {
      logger.logError(
        error instanceof Error ? error : new Error(String(error)),
        { context: "workflow-engine", operation: "notification" },
      );
    }
  }
}

// Export singleton instance
export const workflowEngine = new WorkflowEngine();
