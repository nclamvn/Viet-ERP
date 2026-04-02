"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { convertToNoAccent } from "@/lib/utils/employee";
import {
  EmployeeCreateSchema,
  Step1Schema,
  Step2Schema,
  Step3Schema,
  Step4Schema,
  type EmployeeCreateInput,
} from "@/lib/validations/employee";
import { Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Gender, EmployeeStatus } from ".prisma/hrm-client";

interface Department {
  id: string;
  name: string;
  code: string;
}
interface Position {
  id: string;
  name: string;
  code: string;
  departmentId: string | null;
}
interface EmployeeData {
  id: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string | null;
  permanentAddress: string | null;
  currentAddress: string | null;
  phone: string | null;
  nationalId: string | null;
  nationalIdDate: string | null;
  nationalIdPlace: string | null;
  departmentId: string | null;
  positionId: string | null;
  teamManagerId: string | null;
  jobDescription: string | null;
  startDate: string | null;
  status: EmployeeStatus;
  bankAccount: string | null;
  bankBranch: string | null;
  taxCode: string | null;
  taxCodeOld: string | null;
  insuranceCode: string | null;
  companyEmail: string | null;
  personalEmail: string | null;
  vehiclePlate: string | null;
  school: string | null;
  major: string | null;
  hrDocsSubmitted: HrDocs | null;
  resignDate?: string | null;
  resignDecisionNo?: string | null;
}

interface HrDocs {
  cccd?: boolean;
  degree?: boolean;
  cv?: boolean;
  healthCheck?: boolean;
  photo?: boolean;
  other?: string;
}

interface EmployeeFormProps {
  mode: "create" | "edit";
  employeeId?: string;
  initialData?: EmployeeData;
}

const STEPS = [
  "Thông Tin Cơ Bản",
  "Thông Tin Công Việc",
  "Tài Chính & Bảo Hiểm",
  "Email & Học Vấn & Hồ Sơ",
];

const STEP_SCHEMAS = [Step1Schema, Step2Schema, Step3Schema, Step4Schema];

const GENDER_OPTIONS = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
];

const STATUS_OPTIONS = [
  { value: "PROBATION", label: "Thử việc" },
  { value: "ACTIVE", label: "Đang làm việc" },
  { value: "ON_LEAVE", label: "Nghỉ phép" },
  { value: "RESIGNED", label: "Đã nghỉ" },
  { value: "TERMINATED", label: "Đã chấm dứt" },
  { value: "SUSPENDED", label: "Tạm đình chỉ" },
];

function formatDateForInput(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

export function EmployeeForm({
  mode,
  employeeId,
  initialData,
}: EmployeeFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [nameNoAccent, setNameNoAccent] = useState("");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<EmployeeCreateInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(EmployeeCreateSchema) as any,
    defaultValues: initialData
      ? {
          fullName: initialData.fullName,
          gender: initialData.gender,
          dateOfBirth: formatDateForInput(initialData.dateOfBirth),
          permanentAddress: initialData.permanentAddress || "",
          currentAddress: initialData.currentAddress || "",
          phone: initialData.phone || "",
          nationalId: initialData.nationalId || "",
          nationalIdDate: formatDateForInput(initialData.nationalIdDate),
          nationalIdPlace: initialData.nationalIdPlace || "",
          departmentId: initialData.departmentId || "",
          positionId: initialData.positionId || "",
          teamManagerId: initialData.teamManagerId || "",
          jobDescription: initialData.jobDescription || "",
          startDate: formatDateForInput(initialData.startDate),
          status: initialData.status,
          bankAccount: initialData.bankAccount || "",
          bankBranch: initialData.bankBranch || "",
          taxCode: initialData.taxCode || "",
          taxCodeOld: initialData.taxCodeOld || "",
          insuranceCode: initialData.insuranceCode || "",
          companyEmail: initialData.companyEmail || "",
          personalEmail: initialData.personalEmail || "",
          vehiclePlate: initialData.vehiclePlate || "",
          school: initialData.school || "",
          major: initialData.major || "",
          hrDocsSubmitted: {
            cccd: (initialData.hrDocsSubmitted as HrDocs)?.cccd ?? false,
            degree: (initialData.hrDocsSubmitted as HrDocs)?.degree ?? false,
            cv: (initialData.hrDocsSubmitted as HrDocs)?.cv ?? false,
            healthCheck:
              (initialData.hrDocsSubmitted as HrDocs)?.healthCheck ?? false,
            photo: (initialData.hrDocsSubmitted as HrDocs)?.photo ?? false,
            other: (initialData.hrDocsSubmitted as HrDocs)?.other || "",
          },
        }
      : {
          gender: "MALE" as Gender,
          status: "PROBATION" as EmployeeStatus,
          hrDocsSubmitted: {
            cccd: false,
            degree: false,
            cv: false,
            healthCheck: false,
            photo: false,
            other: "",
          },
        },
  });

  const fullName = watch("fullName");
  const selectedDeptId = watch("departmentId");

  // Auto-convert fullName to nameNoAccent
  useEffect(() => {
    if (fullName) {
      setNameNoAccent(convertToNoAccent(fullName));
    } else {
      setNameNoAccent("");
    }
  }, [fullName]);

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: () => fetch("/api/departments").then((r) => r.json()),
  });

  const { data: positions = [] } = useQuery<Position[]>({
    queryKey: ["positions", selectedDeptId],
    queryFn: () => {
      const url = selectedDeptId
        ? `/api/positions?departmentId=${selectedDeptId}`
        : "/api/positions";
      return fetch(url).then((r) => r.json());
    },
  });

  const { data: employees = [] } = useQuery<
    Array<{ id: string; fullName: string; employeeCode: string }>
  >({
    queryKey: ["employees-for-manager"],
    queryFn: () =>
      fetch("/api/employees?limit=100")
        .then((r) => r.json())
        .then((r) => r.data || []),
  });

  const mutation = useMutation({
    mutationFn: async (data: EmployeeCreateInput) => {
      const url =
        mode === "create" ? "/api/employees" : `/api/employees/${employeeId}`;
      const method = mode === "create" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Lỗi server");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: mode === "create" ? "Thành công" : "Đã cập nhật",
        description:
          mode === "create"
            ? `Đã thêm nhân viên ${data.employeeCode}`
            : "Thông tin nhân viên đã được cập nhật",
      });
      router.push(`/employees/${data.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Lỗi",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validateStep = useCallback(async () => {
    const schema = STEP_SCHEMAS[step];
    const values = getValues();
    const result = schema.safeParse(values);
    if (!result.success) {
      // Trigger react-hook-form errors for current step fields
      const stepFields = Object.keys(schema.shape) as Array<
        keyof EmployeeCreateInput
      >;
      await trigger(stepFields);
      return false;
    }
    return true;
  }, [step, getValues, trigger]);

  const handleNext = async () => {
    const valid = await validateStep();
    if (valid && step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const onSubmit = (data: EmployeeCreateInput) => {
    // Only allow submission from the final step
    if (step !== STEPS.length - 1) return;
    mutation.mutate(data);
  };

  return (
    <div>
      {/* Step Indicator */}
      <div className="flex items-center mb-6 overflow-x-auto">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium shrink-0 ${
                i < step
                  ? "bg-green-500 text-white"
                  : i === step
                    ? "text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
              style={i === step ? { backgroundColor: "#1E3A5F" } : undefined}
            >
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            <span
              className={`ml-2 text-sm whitespace-nowrap hidden sm:inline ${
                i === step ? "font-medium" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className="w-8 h-px bg-slate-300 mx-3 shrink-0" />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* STEP 1: Thông Tin Cơ Bản */}
          {step === 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="fullName">Họ và Tên *</Label>
                  <Input
                    id="fullName"
                    {...register("fullName")}
                    placeholder="Nguyễn Văn An"
                  />
                  {errors.fullName && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.fullName.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="gender">Giới Tính *</Label>
                  <Select
                    value={watch("gender")}
                    onValueChange={(v) => setValue("gender", v as Gender)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          {g.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="dateOfBirth">Ngày Sinh</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    {...register("dateOfBirth")}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Điện Thoại</Label>
                  <Input
                    id="phone"
                    {...register("phone")}
                    placeholder="0901234567"
                    inputMode="tel"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                  {errors.phone && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.phone.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="nationalId">CCCD/CMND</Label>
                  <Input
                    id="nationalId"
                    {...register("nationalId")}
                    placeholder="0123456789XX"
                    maxLength={12}
                    autoCorrect="off"
                    autoCapitalize="off"
                    inputMode="numeric"
                  />
                  {errors.nationalId && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.nationalId.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="nationalIdDate">Ngày Cấp</Label>
                  <Input
                    id="nationalIdDate"
                    type="date"
                    {...register("nationalIdDate")}
                  />
                </div>
                <div>
                  <Label htmlFor="nationalIdPlace">Nơi Cấp</Label>
                  <Input
                    id="nationalIdPlace"
                    {...register("nationalIdPlace")}
                    placeholder="TP.HCM"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="permanentAddress">Địa Chỉ Thường Trú</Label>
                <Input
                  id="permanentAddress"
                  {...register("permanentAddress")}
                />
              </div>
              <div>
                <Label htmlFor="currentAddress">Địa Chỉ Hiện Tại</Label>
                <Input id="currentAddress" {...register("currentAddress")} />
              </div>
            </>
          )}

          {/* STEP 2: Thông Tin Công Việc */}
          {step === 1 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Phòng Ban</Label>
                  <Select
                    value={watch("departmentId") || ""}
                    onValueChange={(v) => {
                      setValue("departmentId", v === "none" ? "" : v);
                      setValue("positionId", "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn phòng ban" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Chưa chọn --</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Chức Vụ</Label>
                  <Select
                    value={watch("positionId") || ""}
                    onValueChange={(v) =>
                      setValue("positionId", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn chức vụ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Chưa chọn --</SelectItem>
                      {positions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Quản Lý Trực Tiếp</Label>
                  <Select
                    value={watch("teamManagerId") || ""}
                    onValueChange={(v) =>
                      setValue("teamManagerId", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn quản lý" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Chưa chọn --</SelectItem>
                      {employees
                        .filter((e) => mode === "create" || e.id !== employeeId)
                        .map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.fullName} ({e.employeeCode})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="startDate">Ngày Vào Làm *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    {...register("startDate")}
                  />
                  {errors.startDate && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.startDate.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Trạng Thái</Label>
                  <Select
                    value={watch("status")}
                    onValueChange={(v) =>
                      setValue("status", v as EmployeeStatus)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="vehiclePlate">Biển Số Xe</Label>
                  <Input
                    id="vehiclePlate"
                    {...register("vehiclePlate")}
                    placeholder="59-XX 123.45"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="jobDescription">Mô Tả Công Việc</Label>
                <Textarea
                  id="jobDescription"
                  {...register("jobDescription")}
                  rows={3}
                />
              </div>
            </>
          )}

          {/* STEP 3: Tài Chính & Bảo Hiểm */}
          {step === 2 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bankAccount">
                    Số Tài Khoản {watch("status") === "ACTIVE" ? "*" : ""}
                  </Label>
                  <Input id="bankAccount" {...register("bankAccount")} />
                  {errors.bankAccount && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.bankAccount.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="bankBranch">Phòng GD/CN</Label>
                  <Input
                    id="bankBranch"
                    {...register("bankBranch")}
                    placeholder="Techcombank - HCM"
                  />
                </div>
              </div>
              <div>
                <Label>Họ Tên Không Dấu (auto)</Label>
                <Input value={nameNoAccent} readOnly className="bg-slate-100" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="taxCode">MST Cá Nhân</Label>
                  <Input id="taxCode" {...register("taxCode")} />
                </div>
                <div>
                  <Label htmlFor="taxCodeOld">MST Cũ (trước 1.7.2025)</Label>
                  <Input id="taxCodeOld" {...register("taxCodeOld")} />
                </div>
              </div>
              <div>
                <Label htmlFor="insuranceCode">Mã Số Bảo Hiểm</Label>
                <Input id="insuranceCode" {...register("insuranceCode")} />
              </div>
            </>
          )}

          {/* STEP 4: Email & Học Vấn & Hồ Sơ */}
          {step === 3 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="companyEmail">Email Công Ty</Label>
                  <Input
                    id="companyEmail"
                    {...register("companyEmail")}
                    placeholder="ten@rtr.vn"
                  />
                  {errors.companyEmail && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.companyEmail.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="personalEmail">Email Cá Nhân</Label>
                  <Input id="personalEmail" {...register("personalEmail")} />
                  {errors.personalEmail && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.personalEmail.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="school">Trường Học</Label>
                  <Input id="school" {...register("school")} />
                </div>
                <div>
                  <Label htmlFor="major">Ngành Học</Label>
                  <Input id="major" {...register("major")} />
                </div>
              </div>
              <div>
                <Label className="mb-3 block">Hồ Sơ Đã Nộp</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: "cccd", label: "CCCD/CMND" },
                    { key: "degree", label: "Bằng cấp" },
                    { key: "cv", label: "Sơ yếu lý lịch" },
                    { key: "healthCheck", label: "Giấy khám sức khỏe" },
                    { key: "photo", label: "Ảnh 3x4" },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        {...register(
                          `hrDocsSubmitted.${key as "cccd" | "degree" | "cv" | "healthCheck" | "photo"}` as const,
                        )}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <Label htmlFor="hrDocsOther">Ghi chú thêm</Label>
                  <Input
                    id="hrDocsOther"
                    {...register("hrDocsSubmitted.other")}
                    placeholder="Các giấy tờ khác..."
                  />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={step === 0 ? () => router.back() : handlePrev}
          className="gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          {step === 0 ? "Quay Lại" : "Trước"}
        </Button>

        <span className="text-sm text-muted-foreground">
          Bước {step + 1}/{STEPS.length}
        </span>

        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={handleNext}
            className="gap-2"
            style={{ backgroundColor: "#1E3A5F" }}
          >
            Tiếp Theo
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit(onSubmit)}
            disabled={mutation.isPending}
            className="gap-2"
            style={{ backgroundColor: "#1E3A5F" }}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? "Lưu Nhân Viên" : "Cập Nhật"}
          </Button>
        )}
      </div>
    </div>
  );
}
