/**
 * Workflow Triggers - Automatically start workflows when entities are created
 * Import and call these functions from entity creation API routes
 */

import { workflowEngine } from "./workflow-engine";
import { WorkflowEntityType } from ".prisma/mrp-client";
import { logger } from "@/lib/logger";

interface TriggerResult {
  triggered: boolean;
  instanceId?: string;
  error?: string;
}

/**
 * Trigger workflow for a Purchase Order
 */
export async function triggerPurchaseOrderWorkflow(
  poId: string,
  userId: string,
  contextData: {
    totalAmount: number;
    supplierId: string;
    supplierName?: string;
    lineCount?: number;
    priority?: string;
  },
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "PO_APPROVAL",
      entityType: "PURCHASE_ORDER" as WorkflowEntityType,
      entityId: poId,
      initiatedBy: userId,
      contextData: {
        amount: contextData.totalAmount,
        ...contextData,
      },
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "PO",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for a Non-Conformance Report
 */
export async function triggerNCRWorkflow(
  ncrId: string,
  userId: string,
  contextData: {
    severity: string;
    partId?: string;
    partNumber?: string;
    workOrderId?: string;
    defectType?: string;
    quantity?: number;
  },
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "NCR_REVIEW",
      entityType: "NCR" as WorkflowEntityType,
      entityId: ncrId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "NCR",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for a CAPA (Corrective/Preventive Action)
 */
export async function triggerCAPAWorkflow(
  capaId: string,
  userId: string,
  contextData: {
    type: "corrective" | "preventive";
    priority: string;
    ncrId?: string;
    rootCause?: string;
  },
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "CAPA_APPROVAL",
      entityType: "CAPA" as WorkflowEntityType,
      entityId: capaId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "CAPA",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for a Work Order
 */
export async function triggerWorkOrderWorkflow(
  woId: string,
  userId: string,
  contextData: {
    productId: string;
    productName?: string;
    quantity: number;
    priority?: string;
    plannedStart?: string;
  },
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "WO_RELEASE",
      entityType: "WORK_ORDER" as WorkflowEntityType,
      entityId: woId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "WO",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for a Sales Order
 */
export async function triggerSalesOrderWorkflow(
  soId: string,
  userId: string,
  contextData: {
    totalAmount: number;
    customerId: string;
    customerName?: string;
    discount?: number;
    creditLimit?: number;
  },
): Promise<TriggerResult> {
  // Only trigger if there's a significant discount
  if (!contextData.discount || contextData.discount <= 10) {
    return {
      triggered: false,
      error: "No workflow required (discount <= 10%)",
    };
  }

  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "SO_APPROVAL",
      entityType: "SALES_ORDER" as WorkflowEntityType,
      entityId: soId,
      initiatedBy: userId,
      contextData: {
        amount: contextData.totalAmount,
        discount_pct: contextData.discount,
        ...contextData,
      },
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "SO",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for Inventory Adjustment
 */
export async function triggerInventoryAdjustmentWorkflow(
  adjustmentId: string,
  userId: string,
  contextData: {
    partId: string;
    partNumber?: string;
    adjustmentType: "increase" | "decrease" | "correction";
    quantity: number;
    value: number;
    reason?: string;
  },
): Promise<TriggerResult> {
  // Only trigger for adjustments above threshold
  if (contextData.value < 1000) {
    return { triggered: false, error: "No workflow required (value < 1000)" };
  }

  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "INV_ADJUSTMENT",
      entityType: "INVENTORY_ADJUSTMENT" as WorkflowEntityType,
      entityId: adjustmentId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "Inventory",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Trigger workflow for Engineering Change Order
 */
export async function triggerEngineeringChangeWorkflow(
  ecoId: string,
  userId: string,
  contextData: {
    changeType: string;
    affectedParts?: string[];
    affectedBoms?: string[];
    reason: string;
    priority?: string;
  },
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode: "ECO_APPROVAL",
      entityType: "ENGINEERING_CHANGE" as WorkflowEntityType,
      entityId: ecoId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "ECO",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}

/**
 * Generic workflow trigger - use for custom workflow codes
 */
export async function triggerWorkflow(
  workflowCode: string,
  entityType: WorkflowEntityType,
  entityId: string,
  userId: string,
  contextData?: Record<string, unknown>,
): Promise<TriggerResult> {
  try {
    const result = await workflowEngine.startWorkflow({
      workflowCode,
      entityType,
      entityId,
      initiatedBy: userId,
      contextData,
    });

    if (result.success) {
      return { triggered: true, instanceId: result.instanceId };
    }
    return { triggered: false, error: result.error };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "workflow-triggers",
      trigger: "Generic",
    });
    return { triggered: false, error: "Failed to trigger workflow" };
  }
}
