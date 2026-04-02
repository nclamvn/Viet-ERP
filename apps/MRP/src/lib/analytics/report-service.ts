// =============================================================================
// VietERP MRP - REPORT SERVICE
// Service for report generation and management
// =============================================================================

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { Prisma } from ".prisma/mrp-client";
import { emailService } from "@/lib/email/email-service";
import type {
  ReportSchedule,
  ReportScheduleCreateInput,
  ReportInstance,
  ReportGenerateInput,
  ReportRecipient,
  ReportFormat,
  ScheduleFrequency,
} from "./types";

// =============================================================================
// REPORT SERVICE CLASS
// =============================================================================

class ReportService {
  // ---------------------------------------------------------------------------
  // Report Generation
  // ---------------------------------------------------------------------------

  async generateReport(input: ReportGenerateInput): Promise<ReportInstance> {
    const {
      reportId,
      format,
      parameters = {},
      recipients,
      sendEmail = false,
      generatedBy = "system",
    } = input;

    // Get the saved report
    const report = await prisma.savedReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new Error("Report not found");
    }

    // Create report instance
    const instance = await prisma.reportInstance.create({
      data: {
        reportId,
        generatedBy, // Caller provides the current user ID via ReportGenerateInput
        parameters: {
          ...((report.filters as Record<string, unknown>) || {}),
          ...parameters,
        } as unknown as Prisma.InputJsonValue,
        format,
        status: "generating",
        recipients: recipients as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      // Generate the report based on format
      const result = await this.executeReportGeneration(
        report,
        instance,
        format,
      );

      // Update instance with file info
      await prisma.reportInstance.update({
        where: { id: instance.id },
        data: {
          status: "completed",
          fileUrl: result.fileUrl,
          fileName: result.fileName,
          fileSize: result.fileSize,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      // Send email if requested
      if (sendEmail && recipients && recipients.length > 0) {
        await this.deliverReport(instance.id, recipients);
      }

      return this.getReportInstance(instance.id) as Promise<ReportInstance>;
    } catch (error) {
      // Update instance with error
      await prisma.reportInstance.update({
        where: { id: instance.id },
        data: {
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  }

  private async executeReportGeneration(
    report: Prisma.SavedReportGetPayload<Record<string, never>>,
    instance: Prisma.ReportInstanceGetPayload<Record<string, never>>,
    format: ReportFormat,
  ): Promise<{ fileUrl: string; fileName: string; fileSize: number }> {
    // Report generation is delegated to the download endpoint, which queries
    // data based on report filters and streams the file in the requested format
    // (PDF/XLSX/CSV). File storage integration (e.g. S3) can be added later;
    // for now the download endpoint generates on-the-fly.
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${report.name.replace(/\s+/g, "_")}_${timestamp}.${format}`;

    return {
      fileUrl: `/api/analytics/reports/instances/${instance.id}/download`,
      fileName,
      fileSize: 0,
    };
  }

  async getReportInstance(id: string): Promise<ReportInstance | null> {
    const instance = await prisma.reportInstance.findUnique({
      where: { id },
    });

    if (!instance) return null;

    return this.toReportInstance(instance);
  }

  async getReportInstances(
    reportId: string,
    limit = 10,
  ): Promise<ReportInstance[]> {
    const instances = await prisma.reportInstance.findMany({
      where: { reportId },
      orderBy: { generatedAt: "desc" },
      take: limit,
    });

    return instances.map((i) => this.toReportInstance(i));
  }

  async recordDownload(instanceId: string): Promise<void> {
    await prisma.reportInstance.update({
      where: { id: instanceId },
      data: {
        downloadCount: { increment: 1 },
        lastDownloadAt: new Date(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Report Scheduling
  // ---------------------------------------------------------------------------

  async createSchedule(
    input: ReportScheduleCreateInput,
    createdBy: string,
  ): Promise<ReportSchedule> {
    const nextRunAt = this.calculateNextRunTime(
      input.frequency,
      input.time,
      input.timezone || "Asia/Ho_Chi_Minh",
      input.dayOfWeek,
      input.dayOfMonth,
    );

    const schedule = await prisma.reportSchedule.create({
      data: {
        reportId: input.reportId,
        name: input.name,
        frequency: input.frequency,
        dayOfWeek: input.dayOfWeek,
        dayOfMonth: input.dayOfMonth,
        time: input.time,
        timezone: input.timezone || "Asia/Ho_Chi_Minh",
        recipients: input.recipients as unknown as Prisma.InputJsonValue,
        outputFormat: input.outputFormat || "pdf",
        parameters: input.parameters as unknown as Prisma.InputJsonValue,
        emailSubject: input.emailSubject,
        emailBody: input.emailBody,
        isActive: true,
        nextRunAt,
        createdBy,
      },
    });

    return this.toReportSchedule(schedule);
  }

  async getSchedule(id: string): Promise<ReportSchedule | null> {
    const schedule = await prisma.reportSchedule.findUnique({
      where: { id },
    });

    if (!schedule) return null;

    return this.toReportSchedule(schedule);
  }

  async getSchedulesForReport(reportId: string): Promise<ReportSchedule[]> {
    const schedules = await prisma.reportSchedule.findMany({
      where: { reportId },
      orderBy: { createdAt: "desc" },
    });

    return schedules.map((s) => this.toReportSchedule(s));
  }

  async updateSchedule(
    id: string,
    data: Partial<ReportScheduleCreateInput>,
  ): Promise<ReportSchedule> {
    const existing = await prisma.reportSchedule.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Schedule not found");
    }

    const frequency = data.frequency || existing.frequency;
    const time = data.time || existing.time;
    const timezone = data.timezone || existing.timezone;
    const dayOfWeek = data.dayOfWeek ?? existing.dayOfWeek;
    const dayOfMonth = data.dayOfMonth ?? existing.dayOfMonth;

    const nextRunAt = this.calculateNextRunTime(
      frequency as ScheduleFrequency,
      time,
      timezone,
      dayOfWeek ?? undefined,
      dayOfMonth ?? undefined,
    );

    const updated = await prisma.reportSchedule.update({
      where: { id },
      data: {
        name: data.name,
        frequency: data.frequency,
        dayOfWeek: data.dayOfWeek,
        dayOfMonth: data.dayOfMonth,
        time: data.time,
        timezone: data.timezone,
        recipients: data.recipients as unknown as Prisma.InputJsonValue,
        outputFormat: data.outputFormat,
        parameters: data.parameters as unknown as Prisma.InputJsonValue,
        emailSubject: data.emailSubject,
        emailBody: data.emailBody,
        nextRunAt,
      },
    });

    return this.toReportSchedule(updated);
  }

  async deleteSchedule(id: string): Promise<void> {
    await prisma.reportSchedule.delete({ where: { id } });
  }

  async toggleSchedule(id: string, isActive: boolean): Promise<ReportSchedule> {
    const updated = await prisma.reportSchedule.update({
      where: { id },
      data: { isActive },
    });

    return this.toReportSchedule(updated);
  }

  // ---------------------------------------------------------------------------
  // Scheduled Execution (Cron Handler)
  // ---------------------------------------------------------------------------

  async runScheduledReports(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const now = new Date();

    // Find all due schedules
    const dueSchedules = await prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
      },
      include: {
        report: true,
      },
    });

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const schedule of dueSchedules) {
      processed++;

      try {
        // Generate the report
        await this.generateReport({
          reportId: schedule.reportId,
          format: schedule.outputFormat as ReportFormat,
          parameters: schedule.parameters as Record<string, unknown>,
          recipients: schedule.recipients as unknown as ReportRecipient[],
          sendEmail: true,
        });

        // Update schedule
        const nextRunAt = this.calculateNextRunTime(
          schedule.frequency as ScheduleFrequency,
          schedule.time,
          schedule.timezone,
          schedule.dayOfWeek ?? undefined,
          schedule.dayOfMonth ?? undefined,
        );

        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            lastRunStatus: "success",
            nextRunAt,
            runCount: { increment: 1 },
          },
        });

        succeeded++;
      } catch (error) {
        // Update schedule with error
        await prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            lastRunStatus: "failed",
          },
        });

        failed++;
        logger.logError(
          error instanceof Error ? error : new Error(String(error)),
          { context: "report-service", scheduleId: schedule.id },
        );
      }
    }

    return { processed, succeeded, failed };
  }

  // ---------------------------------------------------------------------------
  // Email Delivery
  // ---------------------------------------------------------------------------

  async deliverReport(
    instanceId: string,
    recipients: ReportRecipient[],
  ): Promise<void> {
    const instance = await prisma.reportInstance.findUnique({
      where: { id: instanceId },
      include: { report: true },
    });

    if (!instance || instance.status !== "completed") {
      throw new Error("Report instance not ready for delivery");
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const downloadUrl = `${baseUrl}${instance.fileUrl}`;

    // Send email to each recipient
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const recipient of recipients) {
      try {
        // Get user details if it's an internal user
        let recipientEmail = recipient.email;
        let recipientName = recipient.name || "User";

        if (recipient.userId) {
          const user = await prisma.user.findUnique({
            where: { id: recipient.userId },
            select: { email: true, name: true },
          });
          if (user) {
            recipientEmail = user.email;
            recipientName = user.name || "User";
          }
        }

        if (!recipientEmail) {
          results.push({
            email: "unknown",
            success: false,
            error: "No email address",
          });
          continue;
        }

        const result = await emailService.sendReportDelivery(
          recipientEmail,
          recipientName,
          {
            reportName: instance.report.name,
            reportType: instance.format || "PDF",
            generatedAt: instance.generatedAt.toISOString(),
            downloadUrl,
            attachReport: recipient.attachReport,
            // Note: In production, you would fetch the actual file content here
            // reportContent: await fetchReportContent(instance.fileUrl),
            // reportFilename: instance.fileName || `${instance.report.name}.${instance.format}`,
          },
        );

        results.push({
          email: recipientEmail,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        results.push({
          email: recipient.email || "unknown",
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Check if all emails were sent successfully
    const allSuccess = results.every((r) => r.success);
    const anySuccess = results.some((r) => r.success);

    // Update the delivery status
    await prisma.reportInstance.update({
      where: { id: instanceId },
      data: {
        recipients: recipients as unknown as Prisma.InputJsonValue,
        deliveryStatus: allSuccess ? "sent" : anySuccess ? "partial" : "failed",
      },
    });

    // Log results
    logger.info(
      `[ReportService] Delivered report ${instanceId} to ${recipients.length} recipients`,
      {
        results: results
          .map((r) => `${r.email}: ${r.success ? "OK" : r.error}`)
          .join(", "),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private calculateNextRunTime(
    frequency: ScheduleFrequency,
    time: string,
    timezone: string,
    dayOfWeek?: number,
    dayOfMonth?: number,
  ): Date {
    const [hours, minutes] = time.split(":").map(Number);
    const now = new Date();
    const next = new Date(now);

    // Set the time
    next.setHours(hours, minutes, 0, 0);

    // If the time has passed today, start from tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    switch (frequency) {
      case "daily":
        // Already set
        break;

      case "weekly":
        if (dayOfWeek !== undefined) {
          const currentDay = next.getDay();
          let daysUntil = dayOfWeek - currentDay;
          if (daysUntil <= 0) daysUntil += 7;
          if (daysUntil === 0 && next <= now) daysUntil = 7;
          next.setDate(next.getDate() + daysUntil);
        }
        break;

      case "biweekly":
        if (dayOfWeek !== undefined) {
          const currentDay = next.getDay();
          let daysUntil = dayOfWeek - currentDay;
          if (daysUntil <= 0) daysUntil += 14;
          next.setDate(next.getDate() + daysUntil);
        }
        break;

      case "monthly":
        if (dayOfMonth !== undefined) {
          next.setDate(dayOfMonth);
          if (next <= now) {
            next.setMonth(next.getMonth() + 1);
          }
        }
        break;

      case "quarterly":
        if (dayOfMonth !== undefined) {
          const currentMonth = next.getMonth();
          const quarterStart = Math.floor(currentMonth / 3) * 3;
          next.setMonth(quarterStart);
          next.setDate(dayOfMonth);
          if (next <= now) {
            next.setMonth(next.getMonth() + 3);
          }
        }
        break;
    }

    return next;
  }

  private toReportSchedule(
    data: Prisma.ReportScheduleGetPayload<Record<string, never>>,
  ): ReportSchedule {
    return {
      id: data.id,
      reportId: data.reportId,
      name: data.name ?? undefined,
      frequency: data.frequency as ScheduleFrequency,
      dayOfWeek: data.dayOfWeek ?? undefined,
      dayOfMonth: data.dayOfMonth ?? undefined,
      time: data.time,
      timezone: data.timezone,
      recipients: data.recipients as unknown as ReportRecipient[],
      outputFormat: data.outputFormat as ReportFormat,
      parameters: data.parameters as Record<string, unknown>,
      emailSubject: data.emailSubject ?? undefined,
      emailBody: data.emailBody ?? undefined,
      isActive: data.isActive,
      lastRunAt: data.lastRunAt ?? undefined,
      lastRunStatus: data.lastRunStatus as ReportSchedule["lastRunStatus"],
      nextRunAt: data.nextRunAt ?? undefined,
      runCount: data.runCount,
    };
  }

  private toReportInstance(
    data: Prisma.ReportInstanceGetPayload<Record<string, never>>,
  ): ReportInstance {
    return {
      id: data.id,
      scheduleId: data.scheduleId ?? undefined,
      reportId: data.reportId,
      generatedAt: data.generatedAt,
      generatedBy: data.generatedBy,
      parameters: data.parameters as Record<string, unknown>,
      format: data.format as ReportFormat,
      fileUrl: data.fileUrl ?? undefined,
      fileName: data.fileName ?? undefined,
      fileSize: data.fileSize ?? undefined,
      status: data.status as ReportInstance["status"],
      error: data.error ?? undefined,
      expiresAt: data.expiresAt ?? undefined,
      downloadCount: data.downloadCount,
      recipients: data.recipients as unknown as ReportRecipient[],
      deliveryStatus: data.deliveryStatus as ReportInstance["deliveryStatus"],
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const reportService = new ReportService();
export default reportService;
