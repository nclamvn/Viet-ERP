import { Gender, ContractType, AttendanceStatus } from ".prisma/hrm-client";

// ═══════════════ DATE PARSERS ═══════════════

export function parseDate(value: unknown): Date | null {
  if (!value) return null;

  // Excel serial number (e.g. 45000)
  if (typeof value === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }

  const str = String(value).trim();
  if (!str) return null;

  // dd/MM/yyyy
  const ddMMyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddMMyyyy) {
    const [, d, m, y] = ddMMyyyy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  // yyyy-MM-dd
  const isoDate = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) {
    const [, y, m, d] = isoDate;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  // MM/dd/yyyy
  const mmddyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return isNaN(date.getTime()) ? null : date;
  }

  // Fallback: try JS Date parse
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export function isValidDate(value: unknown): boolean {
  return parseDate(value) !== null;
}

// ═══════════════ CURRENCY PARSER ═══════════════

export function parseCurrency(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;

  const str = String(value)
    .trim()
    .replace(/[đĐ]/g, "")
    .replace(/VND/gi, "")
    .replace(/,/g, "")
    .replace(/\./g, "")
    .trim();

  if (!str) return null;
  const num = Number(str);
  return isNaN(num) ? null : num;
}

// ═══════════════ ENUM PARSERS ═══════════════

const GENDER_MAP: Record<string, Gender> = {
  nam: "MALE",
  male: "MALE",
  m: "MALE",
  nữ: "FEMALE",
  nu: "FEMALE",
  female: "FEMALE",
  f: "FEMALE",
  khác: "OTHER",
  khac: "OTHER",
  other: "OTHER",
};

export function parseGender(value: unknown): Gender | null {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return GENDER_MAP[key] ?? null;
}

const CONTRACT_TYPE_MAP: Record<string, ContractType> = {
  "thử việc": "PROBATION",
  "thu viec": "PROBATION",
  probation: "PROBATION",
  "có thời hạn": "DEFINITE_TERM",
  "co thoi han": "DEFINITE_TERM",
  "definite term": "DEFINITE_TERM",
  definite_term: "DEFINITE_TERM",
  "không thời hạn": "INDEFINITE_TERM",
  "khong thoi han": "INDEFINITE_TERM",
  "indefinite term": "INDEFINITE_TERM",
  indefinite_term: "INDEFINITE_TERM",
  "thời vụ": "SEASONAL",
  "thoi vu": "SEASONAL",
  seasonal: "SEASONAL",
  "bán thời gian": "PART_TIME",
  "ban thoi gian": "PART_TIME",
  "part time": "PART_TIME",
  part_time: "PART_TIME",
  "thực tập": "INTERN",
  "thuc tap": "INTERN",
  intern: "INTERN",
};

export function parseContractType(value: unknown): ContractType | null {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return CONTRACT_TYPE_MAP[key] ?? null;
}

const ATTENDANCE_STATUS_MAP: Record<string, AttendanceStatus> = {
  "có mặt": "PRESENT",
  "co mat": "PRESENT",
  present: "PRESENT",
  "đi muộn": "LATE",
  "di muon": "LATE",
  late: "LATE",
  "nửa ngày": "HALF_DAY",
  "nua ngay": "HALF_DAY",
  half_day: "HALF_DAY",
  "half day": "HALF_DAY",
  vắng: "ABSENT",
  vang: "ABSENT",
  absent: "ABSENT",
  "nghỉ phép": "LEAVE",
  "nghi phep": "LEAVE",
  leave: "LEAVE",
  "nghỉ lễ": "HOLIDAY",
  "nghi le": "HOLIDAY",
  holiday: "HOLIDAY",
};

export function parseAttendanceStatus(value: unknown): AttendanceStatus | null {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return ATTENDANCE_STATUS_MAP[key] ?? null;
}

// ═══════════════ CODE GENERATORS ═══════════════

function removeVietnameseAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function generateDeptCode(name: string): string {
  const clean = removeVietnameseAccents(name).toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  return `DEPT-${initials || "X"}`;
}

export function generatePosCode(name: string): string {
  const clean = removeVietnameseAccents(name).toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("");
  return `POS-${initials || "X"}`;
}

// ═══════════════ TIME PARSER ═══════════════

export function parseTime(
  value: unknown,
): { hours: number; minutes: number } | null {
  if (!value) return null;
  const str = String(value).trim();

  // HH:mm or H:mm
  const match = str.match(/^(\d{1,2}):(\d{2})/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return { hours, minutes };
    }
  }

  return null;
}
