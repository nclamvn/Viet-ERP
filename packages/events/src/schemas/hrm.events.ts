// ============================================================
// @vierp/events - HRM Event Schemas
// Sự kiện từ module HRM (Quản lý Nguồn nhân lực)
// ============================================================

import { z } from 'zod';

/**
 * EmployeeOnboarded - Nhân viên được tuyển dụng/bắt đầu
 * Kích hoạt: HR xác nhận nhân viên chính thức
 */
export const EmployeeOnboardedSchema = z.object({
  employeeId: z.string().min(1),
  employeeNumber: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  department: z.string(),
  position: z.string(),
  supervisor: z.string().optional(),
  hireDate: z.string().datetime(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']),
  baseSalary: z.number().positive(),
  currency: z.string().default('VND'),
  costCenter: z.string().optional(),
  address: z.string().optional(),
  personalIdentification: z.string().optional(),
  bankAccount: z.string().optional(),
  taxId: z.string().optional(),
  emergencyContact: z.string().optional(),
  notes: z.string().optional(),
});

export type EmployeeOnboarded = z.infer<typeof EmployeeOnboardedSchema>;

/**
 * LeaveRequested - Yêu cầu phép được tạo
 * Kích hoạt: Nhân viên đệ trình đơn xin phép
 */
export const LeaveRequestedSchema = z.object({
  leaveRequestId: z.string().min(1),
  employeeId: z.string().min(1),
  employeeName: z.string(),
  leaveType: z.enum([
    'annual',
    'sick',
    'unpaid',
    'maternity',
    'paternity',
    'bereavement',
    'other',
  ]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  numberOfDays: z.number().positive(),
  reason: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  attachments: z.array(z.string()).optional(),
  submittedDate: z.string().datetime(),
  supervisor: z.string().optional(),
});

export type LeaveRequested = z.infer<typeof LeaveRequestedSchema>;

/**
 * LeaveApproved - Phép được phê duyệt
 * Kích hoạt: Manager/HR phê duyệt đơn phép
 */
export const LeaveApprovedSchema = z.object({
  leaveRequestId: z.string().min(1),
  leaveApprovalId: z.string().min(1),
  employeeId: z.string().min(1),
  employeeName: z.string(),
  leaveType: z.enum([
    'annual',
    'sick',
    'unpaid',
    'maternity',
    'paternity',
    'bereavement',
    'other',
  ]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  numberOfDays: z.number().positive(),
  approvedBy: z.string().min(1),
  approvedDate: z.string().datetime(),
  approvalNotes: z.string().optional(),
  balanceRemaining: z.number().nonnegative().optional(),
});

export type LeaveApproved = z.infer<typeof LeaveApprovedSchema>;

/**
 * PayrollProcessed - Tính lương được xử lý
 * Kích hoạt: HR chạy tính lương tháng
 * Flow: Trigger JournalEntryPosted (salary expense entries)
 */
export const PayrollProcessedSchema = z.object({
  payrollId: z.string().min(1),
  payrollNumber: z.string().min(1),
  payrollPeriod: z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  }),
  processedDate: z.string().datetime(),
  paymentDate: z.string().datetime().optional(),
  currency: z.string().default('VND'),
  employees: z.array(z.object({
    employeeId: z.string(),
    employeeNumber: z.string(),
    employeeName: z.string(),
    baseSalary: z.number().positive(),
    grossSalary: z.number().positive(),
    incomeTax: z.number().nonnegative(),
    socialInsurance: z.number().nonnegative(),
    healthInsurance: z.number().nonnegative(),
    unemploymentInsurance: z.number().nonnegative(),
    otherDeductions: z.number().nonnegative().optional(),
    netSalary: z.number().nonnegative(),
    department: z.string().optional(),
    costCenter: z.string().optional(),
  })),
  totalGrossSalary: z.number().positive(),
  totalIncomeTax: z.number().nonnegative(),
  totalSocialContributions: z.number().nonnegative(),
  totalNetSalary: z.number().nonnegative(),
  employerContributions: z.number().nonnegative().optional(),
  status: z.enum(['draft', 'processed', 'approved', 'paid']).default('processed'),
  approvedBy: z.string().optional(),
  notes: z.string().optional(),
});

export type PayrollProcessed = z.infer<typeof PayrollProcessedSchema>;

/**
 * AttendanceRecorded - Chấm công được ghi nhập
 * Kích hoạt: Hệ thống chấm công, biometric, hoặc manual entry
 */
export const AttendanceRecordedSchema = z.object({
  attendanceId: z.string().min(1),
  employeeId: z.string().min(1),
  employeeName: z.string(),
  date: z.string().datetime(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  status: z.enum(['present', 'absent', 'late', 'half_day', 'excused']),
  workedHours: z.number().nonnegative().optional(),
  overtime: z.number().nonnegative().optional(),
  location: z.string().optional(),
  device: z.string().optional(),
  notes: z.string().optional(),
  approvedBy: z.string().optional(),
});

export type AttendanceRecorded = z.infer<typeof AttendanceRecordedSchema>;

/**
 * Export all HRM event schemas
 */
export const HRMEventSchemas = {
  'hrm.employee.onboarded': EmployeeOnboardedSchema,
  'hrm.leave.requested': LeaveRequestedSchema,
  'hrm.leave.approved': LeaveApprovedSchema,
  'hrm.payroll.processed': PayrollProcessedSchema,
  'hrm.attendance.recorded': AttendanceRecordedSchema,
} as const;
