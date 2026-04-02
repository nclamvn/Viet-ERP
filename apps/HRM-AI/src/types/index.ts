import type {
  User,
  Tenant,
  Employee,
  Department,
  Position,
  Branch,
  Contract,
  Dependent,
  AuditLog,
  EmployeeChangeHistory,
  UserRole,
  EmployeeStatus,
  Gender,
  ContractType,
  ContractStatus,
  SalaryType,
  RelationshipType,
  // Sprint 2: Time & Attendance
  Shift,
  ShiftAssignment,
  WorkSchedule,
  Holiday,
  Attendance,
  OvertimeRequest,
  AttendanceSummary,
  AttendanceAnomaly,
  ShiftType,
  DayType,
  AttendanceStatus,
  AttendanceSource,
  OTStatus,
  AnomalyType,
  AnomalySeverity,
} from ".prisma/hrm-ai-client";

// Re-export Prisma types
export type {
  User,
  Tenant,
  Employee,
  Department,
  Position,
  Branch,
  Contract,
  Dependent,
  AuditLog,
  EmployeeChangeHistory,
  UserRole,
  EmployeeStatus,
  Gender,
  ContractType,
  ContractStatus,
  SalaryType,
  RelationshipType,
  // Sprint 2: Time & Attendance
  Shift,
  ShiftAssignment,
  WorkSchedule,
  Holiday,
  Attendance,
  OvertimeRequest,
  AttendanceSummary,
  AttendanceAnomaly,
  ShiftType,
  DayType,
  AttendanceStatus,
  AttendanceSource,
  OTStatus,
  AnomalyType,
  AnomalySeverity,
};

// Extended types with relations
export type EmployeeWithRelations = Employee & {
  department?: Department | null;
  position?: Position | null;
  branch?: Branch | null;
  directManager?: Employee | null;
  contracts?: Contract[];
  dependents?: Dependent[];
};

export type ContractWithRelations = Contract & {
  employee?: Employee;
};

export type DepartmentWithRelations = Department & {
  parent?: Department | null;
  children?: Department[];
  manager?: Employee | null;
  _count?: {
    employees: number;
  };
};

export type PositionWithRelations = Position & {
  _count?: {
    employees: number;
  };
};

export type BranchWithRelations = Branch & {
  _count?: {
    employees: number;
  };
};

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// Filter types
export interface EmployeeFilters {
  search?: string;
  departmentId?: string;
  positionId?: string;
  branchId?: string;
  status?: EmployeeStatus;
  page?: number;
  pageSize?: number;
}

export interface ContractFilters {
  search?: string;
  employeeId?: string;
  status?: ContractStatus;
  contractType?: ContractType;
  page?: number;
  pageSize?: number;
}

// Session types
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  employeeId?: string;
}

// Dashboard stats
export interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  probationEmployees: number;
  newHiresThisMonth: number;
  resignedThisMonth: number;
  expiringContracts: number;
}

// Import types
export interface ImportColumn {
  sourceColumn: string;
  targetField: string;
  sampleValue?: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  data: Record<string, unknown>;
  errors: string[];
  isValid: boolean;
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{
    row: number;
    message: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// SPRINT 2: TIME & ATTENDANCE TYPES
// ═══════════════════════════════════════════════════════════════

// Extended types with relations
export type ShiftWithRelations = Shift & {
  _count?: {
    assignments: number;
    attendances: number;
  };
};

export type ShiftAssignmentWithRelations = ShiftAssignment & {
  employee?: Pick<Employee, "id" | "employeeCode" | "fullName"> & {
    department?: Pick<Department, "id" | "name"> | null;
    position?: Pick<Position, "id" | "name"> | null;
  };
  shift?: Shift;
};

export type AttendanceWithRelations = Attendance & {
  employee?: Pick<Employee, "id" | "employeeCode" | "fullName"> & {
    department?: Pick<Department, "id" | "name"> | null;
    position?: Pick<Position, "id" | "name"> | null;
  };
  shift?: Shift | null;
  anomalies?: AttendanceAnomaly[];
};

export type OvertimeRequestWithRelations = OvertimeRequest & {
  employee?: Pick<Employee, "id" | "employeeCode" | "fullName"> & {
    department?: Pick<Department, "id" | "name"> | null;
  };
  approver?: Pick<User, "id" | "name"> | null;
};

export type AttendanceSummaryWithRelations = AttendanceSummary & {
  employee?: Pick<Employee, "id" | "employeeCode" | "fullName"> & {
    department?: Pick<Department, "id" | "name"> | null;
    position?: Pick<Position, "id" | "name"> | null;
  };
};

export type AttendanceAnomalyWithRelations = AttendanceAnomaly & {
  employee?: Pick<Employee, "id" | "employeeCode" | "fullName">;
  attendance?: Attendance;
};

export type HolidayWithRelations = Holiday;

export type WorkScheduleWithRelations = WorkSchedule & {
  department?: Pick<Department, "id" | "name"> | null;
};

// Filter types
export interface ShiftFilters {
  search?: string;
  shiftType?: ShiftType;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ShiftAssignmentFilters {
  employeeId?: string;
  shiftId?: string;
  departmentId?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  isPrimary?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AttendanceFilters {
  search?: string;
  employeeId?: string;
  departmentId?: string;
  shiftId?: string;
  status?: AttendanceStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  pageSize?: number;
}

export interface OvertimeFilters {
  search?: string;
  employeeId?: string;
  departmentId?: string;
  status?: OTStatus;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  pageSize?: number;
}

export interface AttendanceSummaryFilters {
  employeeId?: string;
  departmentId?: string;
  year?: number;
  month?: number;
  isLocked?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AttendanceAnomalyFilters {
  employeeId?: string;
  attendanceId?: string;
  type?: AnomalyType;
  severity?: AnomalySeverity;
  isResolved?: boolean;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  page?: number;
  pageSize?: number;
}

export interface HolidayFilters {
  year?: number;
  isNational?: boolean;
  page?: number;
  pageSize?: number;
}

// Clock in/out types
export interface ClockInRequest {
  source: AttendanceSource;
  latitude?: number;
  longitude?: number;
  address?: string;
  note?: string;
}

export interface ClockOutRequest {
  source: AttendanceSource;
  latitude?: number;
  longitude?: number;
  address?: string;
  note?: string;
}

export interface ClockResponse {
  attendance: Attendance;
  message: string;
}

// Work hours calculation result
export interface WorkHoursResult {
  workHours: number;
  otHours: number;
  nightHours: number;
  lateMinutes: number;
  earlyMinutes: number;
  status: AttendanceStatus;
}

// OT calculation result
export interface OTCalculationResult {
  otHours: number;
  multiplier: number;
  nightBonus: number;
  totalMultiplier: number;
  dayType: DayType;
  isNightShift: boolean;
}

// Monthly summary data
export interface MonthlySummaryData {
  workingDays: number;
  actualWorkDays: number;
  presentDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  sickLeaveDays: number;
  totalWorkHours: number;
  standardHours: number;
  otWeekdayHours: number;
  otWeekendHours: number;
  otHolidayHours: number;
  otNightHours: number;
  totalOtHours: number;
  lateTimes: number;
  earlyLeaveTimes: number;
  totalLateMinutes: number;
  totalEarlyMinutes: number;
  anomalyCount: number;
  unresolvedAnomalies: number;
}

// Calendar event for schedule display
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  color?: string;
  type: "shift" | "holiday" | "attendance" | "leave";
  data?: unknown;
}

// Geolocation types
export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string;
  timestamp: number;
}

// Dashboard stats for attendance
export interface AttendanceDashboardStats {
  todayPresent: number;
  todayAbsent: number;
  todayLate: number;
  todayOnLeave: number;
  pendingOTRequests: number;
  unresolvedAnomalies: number;
  monthlyOTHours: number;
  monthlyAttendanceRate: number;
}
