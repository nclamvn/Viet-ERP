// ============================================================
// HRM Master Data Sync
// Syncs employee data with ERP shared master data service
// ============================================================

import type { Employee as MasterEmployee } from '@vierp/shared';

interface HRMEmployee {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  phone?: string | null;
  departmentName?: string | null;
  positionName?: string | null;
  tenantId: string;
  status: string;
  joinDate: Date;
}

/**
 * Map HRM employee to ERP master data format
 */
export function mapToMasterData(employee: HRMEmployee): Omit<MasterEmployee, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> {
  return {
    id: employee.id,
    code: employee.employeeCode,
    name: employee.fullName,
    email: employee.email,
    phone: employee.phone || undefined,
    department: employee.departmentName || undefined,
    position: employee.positionName || undefined,
    tenantId: employee.tenantId,
    status: mapStatus(employee.status),
    hireDate: employee.joinDate,
    deletedAt: undefined,
  };
}

/**
 * Sync an employee record to the master data service
 * This publishes an event that the Master Data Service will consume
 */
export async function syncEmployeeToMasterData(
  employee: HRMEmployee,
  action: 'create' | 'update' | 'terminate',
  context: { tenantId: string; userId: string }
): Promise<void> {
  const { publish } = await import('@vierp/events');
  const masterData = mapToMasterData(employee);

  const eventMap = {
    create: 'erp.employee.created',
    update: 'erp.employee.updated',
    terminate: 'erp.employee.terminated',
  };

  await publish(eventMap[action], masterData, { ...context, source: 'hrm' });
}

function mapStatus(hrmStatus: string): 'active' | 'inactive' | 'terminated' {
  switch (hrmStatus.toLowerCase()) {
    case 'active':
    case 'working':
    case 'probation':
      return 'active';
    case 'terminated':
    case 'resigned':
    case 'dismissed':
      return 'terminated';
    default:
      return 'inactive';
  }
}
