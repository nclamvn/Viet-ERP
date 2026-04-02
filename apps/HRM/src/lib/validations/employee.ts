import { z } from "zod";
import { Gender, EmployeeStatus } from ".prisma/hrm-client";

// Base object schema (without refinements) — used for .partial()
const EmployeeBaseSchema = z.object({
  // NHÓM A: ĐỊNH DANH
  fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự").max(100),
  gender: z.nativeEnum(Gender),
  dateOfBirth: z.string().optional(),

  // NHÓM B: ĐỊA CHỈ & LIÊN LẠC
  permanentAddress: z.string().optional(),
  currentAddress: z.string().optional(),
  phone: z
    .string()
    .regex(/^(0|\+84)\d{9}$/, "Số điện thoại không hợp lệ")
    .optional()
    .or(z.literal("")),

  // NHÓM C: CCCD
  nationalId: z
    .string()
    .regex(/^\d{9}$|^\d{12}$/, "CCCD phải có 9 hoặc 12 số")
    .optional()
    .or(z.literal("")),
  nationalIdDate: z.string().optional(),
  nationalIdPlace: z.string().optional(),

  // NHÓM D: CÔNG VIỆC
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  teamManagerId: z.string().optional(),
  jobDescription: z.string().optional(),
  startDate: z.string().min(1, "Ngày vào làm là bắt buộc"),
  status: z.nativeEnum(EmployeeStatus).default("PROBATION"),

  // NHÓM G: NGÂN HÀNG & THUẾ
  bankAccount: z.string().optional(),
  bankBranch: z.string().optional(),
  taxCode: z.string().optional(),
  taxCodeOld: z.string().optional(),
  insuranceCode: z.string().optional(),

  // NHÓM H: EMAIL
  companyEmail: z
    .string()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal("")),
  personalEmail: z
    .string()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal("")),

  // NHÓM I: PHƯƠNG TIỆN & HỌC VẤN
  vehiclePlate: z.string().optional(),
  school: z.string().optional(),
  major: z.string().optional(),

  // NHÓM J: HỒ SƠ
  hrDocsSubmitted: z
    .object({
      cccd: z.boolean().default(false),
      degree: z.boolean().default(false),
      cv: z.boolean().default(false),
      healthCheck: z.boolean().default(false),
      photo: z.boolean().default(false),
      other: z.string().optional(),
    })
    .optional(),
});

// Create schema with cross-field validation
export const EmployeeCreateSchema = EmployeeBaseSchema.superRefine(
  (data, ctx) => {
    if (data.status === "ACTIVE" && !data.bankAccount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankAccount"],
        message: "Số tài khoản ngân hàng bắt buộc khi nhân viên ACTIVE",
      });
    }
  },
);

// Update schema — partial base + resign fields (no refinement on partial)
export const EmployeeUpdateSchema = EmployeeBaseSchema.partial().extend({
  resignDate: z.string().optional(),
  resignDecisionNo: z.string().optional(),
});

export type EmployeeCreateInput = z.infer<typeof EmployeeBaseSchema>;
export type EmployeeUpdateInput = z.infer<typeof EmployeeUpdateSchema>;

// Step-specific schemas for multi-step form validation
export const Step1Schema = z.object({
  fullName: z.string().min(2, "Họ tên tối thiểu 2 ký tự").max(100),
  gender: z.nativeEnum(Gender),
  dateOfBirth: z.string().optional(),
  nationalId: z
    .string()
    .regex(/^\d{9}$|^\d{12}$/, "CCCD phải có 9 hoặc 12 số")
    .optional()
    .or(z.literal("")),
  nationalIdDate: z.string().optional(),
  nationalIdPlace: z.string().optional(),
  phone: z
    .string()
    .regex(/^(0|\+84)\d{9}$/, "Số điện thoại không hợp lệ")
    .optional()
    .or(z.literal("")),
  permanentAddress: z.string().optional(),
  currentAddress: z.string().optional(),
});

export const Step2Schema = z.object({
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  teamManagerId: z.string().optional(),
  startDate: z.string().min(1, "Ngày vào làm là bắt buộc"),
  status: z.nativeEnum(EmployeeStatus).default("PROBATION"),
  jobDescription: z.string().optional(),
  vehiclePlate: z.string().optional(),
});

export const Step3Schema = z.object({
  bankAccount: z.string().optional(),
  bankBranch: z.string().optional(),
  taxCode: z.string().optional(),
  taxCodeOld: z.string().optional(),
  insuranceCode: z.string().optional(),
});

export const Step4Schema = z.object({
  companyEmail: z
    .string()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal("")),
  personalEmail: z
    .string()
    .email("Email không hợp lệ")
    .optional()
    .or(z.literal("")),
  school: z.string().optional(),
  major: z.string().optional(),
  hrDocsSubmitted: z
    .object({
      cccd: z.boolean().default(false),
      degree: z.boolean().default(false),
      cv: z.boolean().default(false),
      healthCheck: z.boolean().default(false),
      photo: z.boolean().default(false),
      other: z.string().optional(),
    })
    .optional(),
});
