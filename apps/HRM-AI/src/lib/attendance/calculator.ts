// src/lib/attendance/calculator.ts
// Work hours calculation engine

import type { Shift, DayType, AttendanceStatus } from ".prisma/hrm-ai-client";
import type { WorkHoursResult } from "@/types";
import {
  setTimeOnDate,
  getTimeDiffInMinutes,
  calculateNightHoursOptimized,
  roundHours,
} from "./time-utils";
import { DEFAULT_SHIFT } from "@/constants/attendance";

export interface CalculationInput {
  checkIn: Date;
  checkOut: Date;
  shift: Shift | null;
  dayType?: DayType;
}

/**
 * Calculate work hours, OT hours, late/early minutes
 */
export function calculateWorkHours(input: CalculationInput): WorkHoursResult {
  const { checkIn, checkOut, shift, dayType = "NORMAL" } = input;

  // Use default shift settings if no shift assigned
  const shiftStartTime = shift?.startTime || DEFAULT_SHIFT.START_TIME;
  const shiftEndTime = shift?.endTime || DEFAULT_SHIFT.END_TIME;
  const breakMinutes = shift?.breakMinutes ?? DEFAULT_SHIFT.BREAK_MINUTES;
  const lateGrace = shift?.lateGrace ?? DEFAULT_SHIFT.LATE_GRACE;
  const earlyGrace = shift?.earlyGrace ?? DEFAULT_SHIFT.EARLY_GRACE;
  const otStartAfter = shift?.otStartAfter ?? DEFAULT_SHIFT.OT_START_AFTER;
  const workHoursPerDay = shift?.workHoursPerDay
    ? Number(shift.workHoursPerDay)
    : DEFAULT_SHIFT.WORK_HOURS;

  // Calculate shift times for the date
  const date = new Date(checkIn);
  date.setHours(0, 0, 0, 0);

  const shiftStart = setTimeOnDate(date, shiftStartTime);
  const shiftEnd = setTimeOnDate(date, shiftEndTime);

  // Handle overnight shifts
  if (shift?.isOvernight && shiftEnd <= shiftStart) {
    shiftEnd.setDate(shiftEnd.getDate() + 1);
  }

  // Calculate late minutes (grace period applied)
  let lateMinutes = 0;
  if (checkIn > shiftStart) {
    const actualLate = getTimeDiffInMinutes(shiftStart, checkIn);
    if (actualLate > lateGrace) {
      lateMinutes = actualLate;
    }
  }

  // Calculate early leave minutes (grace period applied)
  let earlyMinutes = 0;
  if (checkOut < shiftEnd) {
    const actualEarly = getTimeDiffInMinutes(checkOut, shiftEnd);
    if (actualEarly > earlyGrace) {
      earlyMinutes = actualEarly;
    }
  }

  // Calculate total worked time
  const totalMinutes = getTimeDiffInMinutes(checkIn, checkOut);

  // Subtract break time (if applicable)
  let effectiveMinutes = totalMinutes;
  if (shift?.breakStartTime && shift?.breakEndTime) {
    const breakStart = setTimeOnDate(date, shift.breakStartTime);
    const breakEnd = setTimeOnDate(date, shift.breakEndTime);

    // Check if break overlaps with work time
    if (checkIn < breakEnd && checkOut > breakStart) {
      const breakOverlapStart = checkIn > breakStart ? checkIn : breakStart;
      const breakOverlapEnd = checkOut < breakEnd ? checkOut : breakEnd;
      const breakOverlap = getTimeDiffInMinutes(
        breakOverlapStart,
        breakOverlapEnd,
      );
      if (breakOverlap > 0) {
        effectiveMinutes -= breakOverlap;
      }
    }
  } else {
    // Use default break deduction if worked full day
    const standardMinutes = workHoursPerDay * 60 + breakMinutes;
    if (totalMinutes >= standardMinutes) {
      effectiveMinutes -= breakMinutes;
    }
  }

  // Calculate standard work hours (capped at shift hours)
  const standardMinutes = workHoursPerDay * 60;
  const workMinutes = Math.min(effectiveMinutes, standardMinutes);
  const workHours = roundHours(workMinutes / 60);

  // Calculate OT hours (time beyond standard shift)
  let otMinutes = 0;
  if (effectiveMinutes > standardMinutes) {
    const extraMinutes = effectiveMinutes - standardMinutes;
    // Only count OT if exceeds threshold
    if (extraMinutes >= otStartAfter) {
      otMinutes = extraMinutes;
    }
  }
  const otHours = roundHours(otMinutes / 60);

  // Calculate night hours (22:00 - 06:00)
  const nightHours = calculateNightHoursOptimized(checkIn, checkOut);

  // Determine attendance status
  const status = determineAttendanceStatus(
    lateMinutes,
    earlyMinutes,
    dayType,
    workHours,
    workHoursPerDay,
  );

  return {
    workHours,
    otHours,
    nightHours,
    lateMinutes,
    earlyMinutes,
    status,
  };
}

/**
 * Determine attendance status based on late/early minutes
 */
function determineAttendanceStatus(
  lateMinutes: number,
  earlyMinutes: number,
  dayType: DayType,
  workHours: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _standardHours: number,
): AttendanceStatus {
  // Holiday
  if (dayType === "HOLIDAY") {
    return "HOLIDAY";
  }

  // Absent if no work hours recorded
  if (workHours === 0) {
    return "ABSENT";
  }

  // Both late and early
  if (lateMinutes > 0 && earlyMinutes > 0) {
    return "LATE_AND_EARLY";
  }

  // Late only
  if (lateMinutes > 0) {
    return "LATE";
  }

  // Early leave only
  if (earlyMinutes > 0) {
    return "EARLY_LEAVE";
  }

  // Present (on time)
  return "PRESENT";
}

/**
 * Calculate expected work hours for a shift
 */
export function getExpectedWorkHours(shift: Shift | null): number {
  if (!shift) {
    return DEFAULT_SHIFT.WORK_HOURS;
  }
  return Number(shift.workHoursPerDay);
}

/**
 * Check if check-in is within allowed time range
 */
export function isCheckInAllowed(
  shift: Shift | null,
  checkInTime: Date,
): boolean {
  const shiftStartTime = shift?.startTime || DEFAULT_SHIFT.START_TIME;
  const shiftStart = setTimeOnDate(checkInTime, shiftStartTime);

  // Allow check-in up to 4 hours before shift start
  const allowedStart = new Date(shiftStart);
  allowedStart.setHours(allowedStart.getHours() - 4);

  // Allow check-in up to shift end
  const shiftEndTime = shift?.endTime || DEFAULT_SHIFT.END_TIME;
  const allowedEnd = setTimeOnDate(checkInTime, shiftEndTime);

  return checkInTime >= allowedStart && checkInTime <= allowedEnd;
}

/**
 * Validate check-out time
 */
export function isCheckOutValid(checkIn: Date, checkOut: Date): boolean {
  // Check-out must be after check-in
  if (checkOut <= checkIn) {
    return false;
  }

  // Maximum shift duration: 24 hours
  const maxDuration = 24 * 60 * 60 * 1000; // 24 hours in ms
  if (checkOut.getTime() - checkIn.getTime() > maxDuration) {
    return false;
  }

  return true;
}

/**
 * Calculate completion percentage for a work day
 */
export function calculateCompletionPercentage(
  workHours: number,
  expectedHours: number,
): number {
  if (expectedHours === 0) return 100;
  const percentage = (workHours / expectedHours) * 100;
  return Math.min(100, Math.round(percentage));
}
