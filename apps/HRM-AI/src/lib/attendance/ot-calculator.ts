// src/lib/attendance/ot-calculator.ts
// OT (Overtime) calculation engine based on Vietnam Labor Law

import type { DayType } from ".prisma/hrm-ai-client";
import type { OTCalculationResult } from "@/types";
import {
  OT_MULTIPLIERS,
  NIGHT_BONUS,
  NIGHT_SHIFT_HOURS,
} from "@/constants/attendance";
import {
  getTimeDiffInHours,
  calculateNightHoursOptimized,
  roundHours,
  isWeekend,
} from "./time-utils";

/**
 * Calculate OT multiplier based on day type
 * - Weekday: 150% (1.5x)
 * - Weekend: 200% (2.0x)
 * - Holiday: 300% (3.0x)
 */
export function getOTMultiplier(dayType: DayType): number {
  switch (dayType) {
    case "HOLIDAY":
      return OT_MULTIPLIERS.HOLIDAY;
    case "WEEKEND":
      return OT_MULTIPLIERS.WEEKEND;
    case "COMPENSATORY":
      return OT_MULTIPLIERS.WEEKDAY;
    default:
      return OT_MULTIPLIERS.WEEKDAY;
  }
}

/**
 * Calculate OT hours with multiplier and night bonus
 */
export function calculateOT(
  startTime: Date,
  endTime: Date,
  dayType: DayType = "NORMAL",
): OTCalculationResult {
  // Calculate total OT hours
  const otHours = roundHours(getTimeDiffInHours(startTime, endTime));

  // Get base multiplier based on day type
  const multiplier = getOTMultiplier(dayType);

  // Calculate night hours within OT period
  const nightHours = calculateNightHoursOptimized(startTime, endTime);
  const isNightShift = nightHours > 0;

  // Night bonus is additional 30% on top of base multiplier
  const nightBonus = isNightShift ? NIGHT_BONUS : 0;

  // Total multiplier = base multiplier + night bonus (if applicable)
  const totalMultiplier = multiplier + nightBonus;

  return {
    otHours,
    multiplier,
    nightBonus,
    totalMultiplier,
    dayType,
    isNightShift,
  };
}

/**
 * Calculate OT pay amount
 */
export function calculateOTPay(
  otHours: number,
  multiplier: number,
  hourlyRate: number,
): number {
  return roundHours(otHours * multiplier * hourlyRate);
}

/**
 * Determine day type from a date
 */
export function determineDayType(date: Date, holidays: Date[] = []): DayType {
  // Check if holiday
  const isHoliday = holidays.some(
    (holiday) =>
      holiday.getFullYear() === date.getFullYear() &&
      holiday.getMonth() === date.getMonth() &&
      holiday.getDate() === date.getDate(),
  );

  if (isHoliday) {
    return "HOLIDAY";
  }

  // Check if weekend
  if (isWeekend(date)) {
    return "WEEKEND";
  }

  return "NORMAL";
}

/**
 * Calculate monthly OT summary
 */
export interface MonthlyOTSummary {
  totalOTHours: number;
  weekdayOTHours: number;
  weekendOTHours: number;
  holidayOTHours: number;
  nightOTHours: number;
  totalMultipliedHours: number;
}

export function calculateMonthlyOTSummary(
  otRecords: Array<{
    hours: number;
    dayType: DayType;
    nightHours: number;
  }>,
): MonthlyOTSummary {
  let totalOTHours = 0;
  let weekdayOTHours = 0;
  let weekendOTHours = 0;
  let holidayOTHours = 0;
  let nightOTHours = 0;
  let totalMultipliedHours = 0;

  for (const record of otRecords) {
    totalOTHours += record.hours;
    nightOTHours += record.nightHours;

    const baseMultiplier = getOTMultiplier(record.dayType);
    const nightBonus = record.nightHours > 0 ? NIGHT_BONUS : 0;

    switch (record.dayType) {
      case "HOLIDAY":
        holidayOTHours += record.hours;
        break;
      case "WEEKEND":
        weekendOTHours += record.hours;
        break;
      default:
        weekdayOTHours += record.hours;
    }

    // Calculate multiplied hours (for pay calculation)
    const regularHours = record.hours - record.nightHours;
    const nightMultipliedHours =
      record.nightHours * (baseMultiplier + nightBonus);
    const regularMultipliedHours = regularHours * baseMultiplier;
    totalMultipliedHours += nightMultipliedHours + regularMultipliedHours;
  }

  return {
    totalOTHours: roundHours(totalOTHours),
    weekdayOTHours: roundHours(weekdayOTHours),
    weekendOTHours: roundHours(weekendOTHours),
    holidayOTHours: roundHours(holidayOTHours),
    nightOTHours: roundHours(nightOTHours),
    totalMultipliedHours: roundHours(totalMultipliedHours),
  };
}

/**
 * Validate OT request
 */
export interface OTValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOTRequest(
  startTime: Date,
  endTime: Date,
  existingOTHours: number = 0,
  maxDailyOT: number = 4,
  maxMonthlyOT: number = 40,
  options?: {
    existingYearlyOTHours?: number;
    /** Max yearly OT hours (default 200, special industries 300 per Article 107) */
    maxYearlyOT?: number;
  },
): OTValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxYearlyOT = options?.maxYearlyOT ?? 200;

  // Check if end time is after start time
  if (endTime <= startTime) {
    errors.push("Thời gian kết thúc phải sau thời gian bắt đầu");
  }

  // Calculate requested hours
  const requestedHours = getTimeDiffInHours(startTime, endTime);

  // Check daily limit (max 4 hours/day by Vietnam law)
  if (requestedHours > maxDailyOT) {
    errors.push(`Thời gian tăng ca không được vượt quá ${maxDailyOT} giờ/ngày`);
  }

  // Check monthly limit (max 40 hours/month by Vietnam Labor Code Article 107)
  if (existingOTHours + requestedHours > maxMonthlyOT) {
    errors.push(
      `Tổng giờ tăng ca trong tháng không được vượt quá ${maxMonthlyOT} giờ (Điều 107 BLLĐ)`,
    );
  }

  // Check yearly limit (max 200h/year, or 300h for special cases per Article 107)
  if (options?.existingYearlyOTHours != null) {
    const yearlyTotal = options.existingYearlyOTHours + requestedHours;
    if (yearlyTotal > maxYearlyOT) {
      errors.push(
        `Tổng giờ tăng ca trong năm không được vượt quá ${maxYearlyOT} giờ (Điều 107 BLLĐ). Hiện tại: ${roundHours(options.existingYearlyOTHours)}h`,
      );
    }
    // Warn if approaching yearly limit (80%)
    if (yearlyTotal > maxYearlyOT * 0.8 && yearlyTotal <= maxYearlyOT) {
      warnings.push(
        `Đã sử dụng ${roundHours(yearlyTotal)}/${maxYearlyOT} giờ tăng ca trong năm`,
      );
    }
  }

  // Warn if approaching monthly limit
  if (
    existingOTHours + requestedHours > maxMonthlyOT * 0.8 &&
    existingOTHours + requestedHours <= maxMonthlyOT
  ) {
    warnings.push(
      `Đã sử dụng ${roundHours(existingOTHours + requestedHours)}/${maxMonthlyOT} giờ tăng ca trong tháng`,
    );
  }

  // Check minimum OT duration (at least 30 minutes)
  if (requestedHours < 0.5) {
    errors.push("Thời gian tăng ca tối thiểu là 30 phút");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if time is within night shift hours
 */
export function isNightShiftTime(time: Date): boolean {
  const hours = time.getHours();
  const nightStart = parseInt(NIGHT_SHIFT_HOURS.START.split(":")[0]);
  const nightEnd = parseInt(NIGHT_SHIFT_HOURS.END.split(":")[0]);

  return hours >= nightStart || hours < nightEnd;
}

/**
 * Format OT multiplier for display
 */
export function formatMultiplier(multiplier: number): string {
  return `${Math.round(multiplier * 100)}%`;
}

/**
 * Get OT rate description
 */
export function getOTRateDescription(
  dayType: DayType,
  isNightShift: boolean,
): string {
  let description = "";

  switch (dayType) {
    case "HOLIDAY":
      description = "Ngày lễ (300%)";
      break;
    case "WEEKEND":
      description = "Cuối tuần (200%)";
      break;
    default:
      description = "Ngày thường (150%)";
  }

  if (isNightShift) {
    description += " + Ca đêm (+30%)";
  }

  return description;
}
