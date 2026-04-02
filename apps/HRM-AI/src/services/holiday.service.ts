// src/services/holiday.service.ts
// Holiday management service

import { db } from "@/lib/db";
import type {
  HolidayFilters,
  PaginatedResponse,
  HolidayWithRelations,
} from "@/types";
import type { Prisma, DayType } from ".prisma/hrm-ai-client";

export const holidayService = {
  // ═══════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  async findAll(
    tenantId: string,
    filters: HolidayFilters = {},
  ): Promise<PaginatedResponse<HolidayWithRelations>> {
    const { year, isNational, page = 1, pageSize = 50 } = filters;

    const where: Prisma.HolidayWhereInput = {
      tenantId,
      ...(year && { year }),
      ...(isNational !== undefined && { isNational }),
    };

    const [data, total] = await Promise.all([
      db.holiday.findMany({
        where,
        orderBy: [{ date: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.holiday.count({ where }),
    ]);

    return {
      data: data as unknown as HolidayWithRelations[],
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  },

  async findById(
    tenantId: string,
    id: string,
  ): Promise<HolidayWithRelations | null> {
    return db.holiday.findFirst({
      where: { id, tenantId },
    }) as unknown as Promise<HolidayWithRelations | null>;
  },

  async findByDate(tenantId: string, date: Date) {
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);

    return db.holiday.findFirst({
      where: {
        tenantId,
        date: { lte: dateStart },
        OR: [
          { endDate: null, date: dateStart },
          { endDate: { gte: dateStart } },
        ],
      },
    });
  },

  async create(
    tenantId: string,
    data: {
      name: string;
      date: Date;
      endDate?: Date | null;
      dayType?: DayType;
      compensatoryDate?: Date | null;
      isRecurring?: boolean;
      isNational?: boolean;
      notes?: string;
    },
  ) {
    const year = data.date.getFullYear();

    return db.holiday.create({
      data: {
        tenantId,
        name: data.name,
        date: data.date,
        endDate: data.endDate,
        dayType: data.dayType || "HOLIDAY",
        compensatoryDate: data.compensatoryDate,
        isRecurring: data.isRecurring ?? false,
        isNational: data.isNational ?? true,
        year,
        notes: data.notes,
      },
    });
  },

  async update(
    tenantId: string,
    id: string,
    data: {
      name?: string;
      date?: Date;
      endDate?: Date | null;
      dayType?: DayType;
      compensatoryDate?: Date | null;
      isRecurring?: boolean;
      isNational?: boolean;
      notes?: string;
    },
  ) {
    const holiday = await db.holiday.findFirst({
      where: { id, tenantId },
    });

    if (!holiday) {
      throw new Error("Ngày lễ không tồn tại");
    }

    const year = data.date ? data.date.getFullYear() : holiday.year;

    return db.holiday.update({
      where: { id },
      data: {
        name: data.name,
        date: data.date,
        endDate: data.endDate,
        dayType: data.dayType,
        compensatoryDate: data.compensatoryDate,
        isRecurring: data.isRecurring,
        isNational: data.isNational,
        year,
        notes: data.notes,
      },
    });
  },

  async delete(tenantId: string, id: string) {
    const holiday = await db.holiday.findFirst({
      where: { id, tenantId },
    });

    if (!holiday) {
      throw new Error("Ngày lễ không tồn tại");
    }

    return db.holiday.delete({
      where: { id },
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  async getHolidaysInRange(tenantId: string, startDate: Date, endDate: Date) {
    return db.holiday.findMany({
      where: {
        tenantId,
        OR: [
          {
            date: { gte: startDate, lte: endDate },
          },
          {
            endDate: { gte: startDate, lte: endDate },
          },
        ],
      },
      orderBy: { date: "asc" },
    });
  },

  async getHolidayDates(tenantId: string, year: number): Promise<Date[]> {
    const holidays = await db.holiday.findMany({
      where: { tenantId, year },
    });

    const dates: Date[] = [];

    for (const holiday of holidays) {
      const start = new Date(holiday.date);
      const end = holiday.endDate ? new Date(holiday.endDate) : start;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d));
      }
    }

    return dates;
  },

  async isHoliday(tenantId: string, date: Date): Promise<boolean> {
    const holiday = await this.findByDate(tenantId, date);
    return !!holiday;
  },

  async getUpcomingHolidays(tenantId: string, limit = 5) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return db.holiday.findMany({
      where: {
        tenantId,
        date: { gte: today },
      },
      orderBy: { date: "asc" },
      take: limit,
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // SEED NATIONAL HOLIDAYS
  // ═══════════════════════════════════════════════════════════════

  async seedNationalHolidays(tenantId: string, year: number) {
    const holidays = [
      {
        name: "Tết Dương lịch",
        date: new Date(year, 0, 1), // Jan 1
        isNational: true,
        isRecurring: true,
      },
      {
        name: "Ngày Giải phóng miền Nam",
        date: new Date(year, 3, 30), // Apr 30
        isNational: true,
        isRecurring: true,
      },
      {
        name: "Ngày Quốc tế Lao động",
        date: new Date(year, 4, 1), // May 1
        isNational: true,
        isRecurring: true,
      },
      {
        name: "Ngày Quốc khánh",
        date: new Date(year, 8, 2), // Sep 2
        endDate: new Date(year, 8, 3), // Sep 3
        isNational: true,
        isRecurring: true,
      },
    ];

    const created = [];

    for (const holiday of holidays) {
      // Check if already exists
      const existing = await db.holiday.findFirst({
        where: {
          tenantId,
          name: holiday.name,
          year,
        },
      });

      if (!existing) {
        const created_holiday = await this.create(tenantId, {
          ...holiday,
          dayType: "HOLIDAY",
        });
        created.push(created_holiday);
      }
    }

    return {
      created: created.length,
      holidays: created,
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // COMPENSATORY DAYS
  // ═══════════════════════════════════════════════════════════════

  async getCompensatoryDays(tenantId: string, year: number) {
    return db.holiday.findMany({
      where: {
        tenantId,
        year,
        dayType: "COMPENSATORY",
      },
      orderBy: { date: "asc" },
    });
  },

  async addCompensatoryDay(
    tenantId: string,
    data: {
      name: string;
      date: Date;
      forHolidayId?: string;
      notes?: string;
    },
  ) {
    return this.create(tenantId, {
      name: data.name,
      date: data.date,
      dayType: "COMPENSATORY",
      isNational: false,
      isRecurring: false,
      notes: data.notes,
    });
  },
};
