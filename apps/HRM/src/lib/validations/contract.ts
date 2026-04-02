import { z } from "zod";
import { ContractType } from ".prisma/hrm-client";
import { differenceInDays } from "date-fns";

export const ContractCreateSchema = z
  .object({
    type: z.nativeEnum(ContractType),
    contractNo: z.string().optional(),
    probationNo: z.string().optional(),
    probationFrom: z.string().optional(),
    probationTo: z.string().optional(),
    officialFrom: z.string().optional(),
    officialTo: z.string().optional().nullable(),
    baseSalary: z.number().positive().optional(),
    mealAllowance: z.number().min(0).optional(),
    phoneAllowance: z.number().min(0).optional(),
    fuelAllowance: z.number().min(0).optional(),
    perfAllowance: z.number().min(0).optional(),
    kpiAmount: z.number().min(0).optional(),
    annexNo1: z.string().optional(),
    annexDate1: z.string().optional(),
    annexNo2: z.string().optional(),
    annexDate2: z.string().optional(),
    annexNo3: z.string().optional(),
    annexDate3: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PROBATION") {
      if (!data.probationFrom || !data.probationTo) {
        ctx.addIssue({
          code: "custom",
          path: ["probationTo"],
          message: "Ngày bắt đầu và kết thúc thử việc là bắt buộc",
        });
      }
      if (data.probationFrom && data.probationTo) {
        const diff = differenceInDays(
          new Date(data.probationTo),
          new Date(data.probationFrom),
        );
        if (diff > 60) {
          ctx.addIssue({
            code: "custom",
            path: ["probationTo"],
            message: "Thử việc tối đa 60 ngày theo Bộ luật Lao động",
          });
        }
      }
    }
    if (["DEFINITE_TERM", "INTERN"].includes(data.type)) {
      if (!data.officialFrom || !data.officialTo) {
        ctx.addIssue({
          code: "custom",
          path: ["officialTo"],
          message: "Ngày bắt đầu và kết thúc hợp đồng là bắt buộc",
        });
      }
    }
    if (data.type === "INDEFINITE_TERM") {
      if (!data.officialFrom) {
        ctx.addIssue({
          code: "custom",
          path: ["officialFrom"],
          message: "Ngày bắt đầu hợp đồng là bắt buộc",
        });
      }
    }
  });

export const ContractUpdateSchema = z.object({
  contractNo: z.string().optional(),
  probationNo: z.string().optional(),
  baseSalary: z.number().positive().optional(),
  mealAllowance: z.number().min(0).optional(),
  phoneAllowance: z.number().min(0).optional(),
  fuelAllowance: z.number().min(0).optional(),
  perfAllowance: z.number().min(0).optional(),
  kpiAmount: z.number().min(0).optional(),
  annexNo1: z.string().optional(),
  annexDate1: z.string().optional(),
  annexNo2: z.string().optional(),
  annexDate2: z.string().optional(),
  annexNo3: z.string().optional(),
  annexDate3: z.string().optional(),
  notes: z.string().optional(),
});
