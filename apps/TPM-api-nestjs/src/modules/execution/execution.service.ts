import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { createPaginatedResponse, getPaginationParams } from '../../common/dto/pagination.dto';
import { Prisma } from '.prisma/tpm-nestjs-client';
import { TrackingQueryDto } from './dto/tracking-query.dto';
import { CreateTrackingDto } from './dto/create-tracking.dto';
import { SellInQueryDto } from './dto/sell-in-query.dto';
import { CreateSellInDto } from './dto/create-sell-in.dto';
import { SellOutQueryDto } from './dto/sell-out-query.dto';
import { CreateSellOutDto } from './dto/create-sell-out.dto';
import { PerformanceQueryDto } from './dto/performance-query.dto';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL TRACKING - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllTracking(query: TrackingQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const { customerId, productId, period, sortBy = 'createdAt', sortOrder = 'desc' } = query;

    const where: Prisma.SellTrackingWhereInput = {};

    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (period) where.period = period;

    const validSortFields = ['createdAt', 'period', 'sellInQty', 'sellOutQty', 'stockQty'];
    const orderBy: Prisma.SellTrackingOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.sellTracking.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
        },
      }),
      this.prisma.sellTracking.count({ where }),
    ]);

    const transformedData = data.map((t) => this.transformTracking(t));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL TRACKING - CREATE/UPSERT
  // ═══════════════════════════════════════════════════════════════════════════
  async upsertTracking(dto: CreateTrackingDto) {
    const record = await this.prisma.sellTracking.upsert({
      where: {
        customerId_productId_period: {
          customerId: dto.customerId,
          productId: dto.productId,
          period: dto.period,
        },
      },
      update: {
        sellInQty: dto.sellInQty ?? 0,
        sellInValue: dto.sellInValue ?? 0,
        sellOutQty: dto.sellOutQty ?? 0,
        sellOutValue: dto.sellOutValue ?? 0,
        stockQty: dto.stockQty ?? 0,
        stockValue: dto.stockValue ?? 0,
      },
      create: {
        customerId: dto.customerId,
        productId: dto.productId,
        period: dto.period,
        sellInQty: dto.sellInQty ?? 0,
        sellInValue: dto.sellInValue ?? 0,
        sellOutQty: dto.sellOutQty ?? 0,
        sellOutValue: dto.sellOutValue ?? 0,
        stockQty: dto.stockQty ?? 0,
        stockValue: dto.stockValue ?? 0,
      },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });

    this.logger.log(
      `Sell tracking upserted: ${record.customerId}/${record.productId}/${record.period}`,
    );

    return this.transformTracking(record);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL TRACKING - SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getTrackingSummary(period?: string) {
    const where: Prisma.SellTrackingWhereInput = {};
    if (period) where.period = period;

    const records = await this.prisma.sellTracking.findMany({
      where,
      select: {
        period: true,
        sellInQty: true,
        sellInValue: true,
        sellOutQty: true,
        sellOutValue: true,
        stockQty: true,
        stockValue: true,
      },
    });

    const byPeriod: Record<
      string,
      {
        period: string;
        totalSellInQty: number;
        totalSellInValue: number;
        totalSellOutQty: number;
        totalSellOutValue: number;
        totalStockQty: number;
        totalStockValue: number;
        recordCount: number;
      }
    > = {};

    records.forEach((r) => {
      if (!byPeriod[r.period]) {
        byPeriod[r.period] = {
          period: r.period,
          totalSellInQty: 0,
          totalSellInValue: 0,
          totalSellOutQty: 0,
          totalSellOutValue: 0,
          totalStockQty: 0,
          totalStockValue: 0,
          recordCount: 0,
        };
      }
      byPeriod[r.period].totalSellInQty += r.sellInQty;
      byPeriod[r.period].totalSellInValue += Number(r.sellInValue);
      byPeriod[r.period].totalSellOutQty += r.sellOutQty;
      byPeriod[r.period].totalSellOutValue += Number(r.sellOutValue);
      byPeriod[r.period].totalStockQty += r.stockQty;
      byPeriod[r.period].totalStockValue += Number(r.stockValue);
      byPeriod[r.period].recordCount += 1;
    });

    return {
      totalRecords: records.length,
      periods: Object.values(byPeriod),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL IN - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllSellIn(query: SellInQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      companyId,
      customerId,
      productId,
      promotionId,
      periodYear,
      periodMonth,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.SellInWhereInput = {};

    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (promotionId) where.promotionId = promotionId;
    if (periodYear) where.periodYear = periodYear;
    if (periodMonth) where.periodMonth = periodMonth;

    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = new Date(dateFrom);
      if (dateTo) where.transactionDate.lte = new Date(dateTo);
    }

    const validSortFields = ['createdAt', 'transactionDate', 'quantity', 'grossValue', 'netValue'];
    const orderBy: Prisma.SellInOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.sellIn.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
          promotion: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.sellIn.count({ where }),
    ]);

    const transformedData = data.map((r) => this.transformSellIn(r));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL IN - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createSellIn(dto: CreateSellInDto, userId: string) {
    const record = await this.prisma.sellIn.create({
      data: {
        companyId: dto.companyId,
        transactionCode: dto.transactionCode,
        transactionDate: new Date(dto.transactionDate),
        promotionId: dto.promotionId,
        customerId: dto.customerId,
        channelId: dto.channelId,
        regionId: dto.regionId,
        productId: dto.productId,
        quantity: dto.quantity,
        quantityCase: dto.quantityCase,
        grossValue: dto.grossValue,
        discountValue: dto.discountValue,
        netValue: dto.netValue,
        sourceSystem: dto.sourceSystem,
        sourceReference: dto.sourceReference,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        periodWeek: dto.periodWeek,
        importedById: userId,
      },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        promotion: { select: { id: true, name: true, code: true } },
      },
    });

    this.logger.log(`Sell-in created: ${record.transactionCode} by user ${userId}`);

    return this.transformSellIn(record);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL IN - SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSellInSummary(query: SellInQueryDto) {
    const { companyId, customerId, productId, periodYear, periodMonth } = query;

    const where: Prisma.SellInWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (periodYear) where.periodYear = periodYear;
    if (periodMonth) where.periodMonth = periodMonth;

    const records = await this.prisma.sellIn.findMany({
      where,
      select: {
        periodYear: true,
        periodMonth: true,
        quantity: true,
        grossValue: true,
        discountValue: true,
        netValue: true,
      },
    });

    const byPeriod: Record<
      string,
      {
        periodYear: number;
        periodMonth: number;
        totalQuantity: number;
        totalGrossValue: number;
        totalDiscountValue: number;
        totalNetValue: number;
        recordCount: number;
      }
    > = {};

    records.forEach((r) => {
      const key = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`;
      if (!byPeriod[key]) {
        byPeriod[key] = {
          periodYear: r.periodYear,
          periodMonth: r.periodMonth,
          totalQuantity: 0,
          totalGrossValue: 0,
          totalDiscountValue: 0,
          totalNetValue: 0,
          recordCount: 0,
        };
      }
      byPeriod[key].totalQuantity += r.quantity;
      byPeriod[key].totalGrossValue += Number(r.grossValue);
      byPeriod[key].totalDiscountValue += Number(r.discountValue ?? 0);
      byPeriod[key].totalNetValue += Number(r.netValue);
      byPeriod[key].recordCount += 1;
    });

    return {
      totalRecords: records.length,
      totalGrossValue: records.reduce((sum, r) => sum + Number(r.grossValue), 0),
      totalNetValue: records.reduce((sum, r) => sum + Number(r.netValue), 0),
      periods: Object.values(byPeriod),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL OUT - LIST
  // ═══════════════════════════════════════════════════════════════════════════
  async findAllSellOut(query: SellOutQueryDto) {
    const { skip, take, page, pageSize } = getPaginationParams(query);
    const {
      companyId,
      customerId,
      productId,
      promotionId,
      periodYear,
      periodMonth,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.SellOutWhereInput = {};

    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (promotionId) where.promotionId = promotionId;
    if (periodYear) where.periodYear = periodYear;
    if (periodMonth) where.periodMonth = periodMonth;

    if (dateFrom || dateTo) {
      where.transactionDate = {};
      if (dateFrom) where.transactionDate.gte = new Date(dateFrom);
      if (dateTo) where.transactionDate.lte = new Date(dateTo);
    }

    const validSortFields = [
      'createdAt',
      'transactionDate',
      'quantity',
      'totalValue',
      'sellingPrice',
    ];
    const orderBy: Prisma.SellOutOrderByWithRelationInput =
      sortBy && validSortFields.includes(sortBy) ? { [sortBy]: sortOrder } : { createdAt: 'desc' };

    const [data, total] = await Promise.all([
      this.prisma.sellOut.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
          promotion: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.sellOut.count({ where }),
    ]);

    const transformedData = data.map((r) => this.transformSellOut(r));

    return createPaginatedResponse(transformedData, total, page, pageSize);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL OUT - CREATE
  // ═══════════════════════════════════════════════════════════════════════════
  async createSellOut(dto: CreateSellOutDto, userId: string) {
    const record = await this.prisma.sellOut.create({
      data: {
        companyId: dto.companyId,
        transactionCode: dto.transactionCode,
        transactionDate: new Date(dto.transactionDate),
        promotionId: dto.promotionId,
        customerId: dto.customerId,
        channelId: dto.channelId,
        regionId: dto.regionId,
        productId: dto.productId,
        quantity: dto.quantity,
        quantityCase: dto.quantityCase,
        sellingPrice: dto.sellingPrice,
        totalValue: dto.totalValue,
        sourceSystem: dto.sourceSystem,
        sourceReference: dto.sourceReference,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        periodWeek: dto.periodWeek,
        importedById: userId,
      },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        product: { select: { id: true, name: true, sku: true } },
        promotion: { select: { id: true, name: true, code: true } },
      },
    });

    this.logger.log(`Sell-out created: ${record.transactionCode} by user ${userId}`);

    return this.transformSellOut(record);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELL OUT - SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  async getSellOutSummary(query: SellOutQueryDto) {
    const { companyId, customerId, productId, periodYear, periodMonth } = query;

    const where: Prisma.SellOutWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (customerId) where.customerId = customerId;
    if (productId) where.productId = productId;
    if (periodYear) where.periodYear = periodYear;
    if (periodMonth) where.periodMonth = periodMonth;

    const records = await this.prisma.sellOut.findMany({
      where,
      select: {
        periodYear: true,
        periodMonth: true,
        quantity: true,
        sellingPrice: true,
        totalValue: true,
      },
    });

    const byPeriod: Record<
      string,
      {
        periodYear: number;
        periodMonth: number;
        totalQuantity: number;
        totalValue: number;
        recordCount: number;
      }
    > = {};

    records.forEach((r) => {
      const key = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`;
      if (!byPeriod[key]) {
        byPeriod[key] = {
          periodYear: r.periodYear,
          periodMonth: r.periodMonth,
          totalQuantity: 0,
          totalValue: 0,
          recordCount: 0,
        };
      }
      byPeriod[key].totalQuantity += r.quantity;
      byPeriod[key].totalValue += Number(r.totalValue);
      byPeriod[key].recordCount += 1;
    });

    return {
      totalRecords: records.length,
      totalValue: records.reduce((sum, r) => sum + Number(r.totalValue), 0),
      periods: Object.values(byPeriod),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMBINED PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════════
  async getPerformance(query: PerformanceQueryDto) {
    const { companyId, customerId, productId, promotionId, periodYear, periodMonth } = query;

    // Build sell-in where
    const sellInWhere: Prisma.SellInWhereInput = {};
    if (companyId) sellInWhere.companyId = companyId;
    if (customerId) sellInWhere.customerId = customerId;
    if (productId) sellInWhere.productId = productId;
    if (promotionId) sellInWhere.promotionId = promotionId;
    if (periodYear) sellInWhere.periodYear = periodYear;
    if (periodMonth) sellInWhere.periodMonth = periodMonth;

    // Build sell-out where
    const sellOutWhere: Prisma.SellOutWhereInput = {};
    if (companyId) sellOutWhere.companyId = companyId;
    if (customerId) sellOutWhere.customerId = customerId;
    if (productId) sellOutWhere.productId = productId;
    if (promotionId) sellOutWhere.promotionId = promotionId;
    if (periodYear) sellOutWhere.periodYear = periodYear;
    if (periodMonth) sellOutWhere.periodMonth = periodMonth;

    const [sellInRecords, sellOutRecords] = await Promise.all([
      this.prisma.sellIn.findMany({
        where: sellInWhere,
        select: {
          periodYear: true,
          periodMonth: true,
          quantity: true,
          grossValue: true,
          netValue: true,
        },
      }),
      this.prisma.sellOut.findMany({
        where: sellOutWhere,
        select: {
          periodYear: true,
          periodMonth: true,
          quantity: true,
          totalValue: true,
        },
      }),
    ]);

    // Aggregate sell-in by period
    const sellInByPeriod: Record<
      string,
      { quantity: number; grossValue: number; netValue: number }
    > = {};
    sellInRecords.forEach((r) => {
      const key = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`;
      if (!sellInByPeriod[key]) {
        sellInByPeriod[key] = { quantity: 0, grossValue: 0, netValue: 0 };
      }
      sellInByPeriod[key].quantity += r.quantity;
      sellInByPeriod[key].grossValue += Number(r.grossValue);
      sellInByPeriod[key].netValue += Number(r.netValue);
    });

    // Aggregate sell-out by period
    const sellOutByPeriod: Record<string, { quantity: number; totalValue: number }> = {};
    sellOutRecords.forEach((r) => {
      const key = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`;
      if (!sellOutByPeriod[key]) {
        sellOutByPeriod[key] = { quantity: 0, totalValue: 0 };
      }
      sellOutByPeriod[key].quantity += r.quantity;
      sellOutByPeriod[key].totalValue += Number(r.totalValue);
    });

    // Combine periods
    const allPeriods = new Set([...Object.keys(sellInByPeriod), ...Object.keys(sellOutByPeriod)]);

    const performance = Array.from(allPeriods)
      .sort()
      .map((period) => {
        const sellIn = sellInByPeriod[period] || { quantity: 0, grossValue: 0, netValue: 0 };
        const sellOut = sellOutByPeriod[period] || { quantity: 0, totalValue: 0 };
        const sellThrough =
          sellIn.quantity > 0 ? Number(((sellOut.quantity / sellIn.quantity) * 100).toFixed(2)) : 0;

        return {
          period,
          sellIn: {
            quantity: sellIn.quantity,
            grossValue: sellIn.grossValue,
            netValue: sellIn.netValue,
          },
          sellOut: {
            quantity: sellOut.quantity,
            totalValue: sellOut.totalValue,
          },
          sellThroughRate: sellThrough,
        };
      });

    // Totals
    const totalSellInQty = sellInRecords.reduce((sum, r) => sum + r.quantity, 0);
    const totalSellInValue = sellInRecords.reduce((sum, r) => sum + Number(r.netValue), 0);
    const totalSellOutQty = sellOutRecords.reduce((sum, r) => sum + r.quantity, 0);
    const totalSellOutValue = sellOutRecords.reduce((sum, r) => sum + Number(r.totalValue), 0);
    const overallSellThrough =
      totalSellInQty > 0 ? Number(((totalSellOutQty / totalSellInQty) * 100).toFixed(2)) : 0;

    return {
      summary: {
        totalSellInQty,
        totalSellInValue,
        totalSellOutQty,
        totalSellOutValue,
        overallSellThroughRate: overallSellThrough,
        sellInRecordCount: sellInRecords.length,
        sellOutRecordCount: sellOutRecords.length,
      },
      byPeriod: performance,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFORM HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  private transformTracking(record: any) {
    return {
      id: record.id,
      customerId: record.customerId,
      customer: record.customer || null,
      productId: record.productId,
      product: record.product || null,
      period: record.period,
      sellInQty: record.sellInQty,
      sellInValue: Number(record.sellInValue),
      sellOutQty: record.sellOutQty,
      sellOutValue: Number(record.sellOutValue),
      stockQty: record.stockQty,
      stockValue: Number(record.stockValue),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private transformSellIn(record: any) {
    return {
      id: record.id,
      companyId: record.companyId,
      transactionCode: record.transactionCode,
      transactionDate: record.transactionDate,
      promotionId: record.promotionId,
      promotion: record.promotion || null,
      customerId: record.customerId,
      customer: record.customer || null,
      channelId: record.channelId,
      regionId: record.regionId,
      productId: record.productId,
      product: record.product || null,
      quantity: record.quantity,
      quantityCase: record.quantityCase ? Number(record.quantityCase) : null,
      grossValue: Number(record.grossValue),
      discountValue: record.discountValue ? Number(record.discountValue) : null,
      netValue: Number(record.netValue),
      sourceSystem: record.sourceSystem,
      sourceReference: record.sourceReference,
      periodYear: record.periodYear,
      periodMonth: record.periodMonth,
      periodWeek: record.periodWeek,
      importedAt: record.importedAt,
      importedById: record.importedById,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private transformSellOut(record: any) {
    return {
      id: record.id,
      companyId: record.companyId,
      transactionCode: record.transactionCode,
      transactionDate: record.transactionDate,
      promotionId: record.promotionId,
      promotion: record.promotion || null,
      customerId: record.customerId,
      customer: record.customer || null,
      channelId: record.channelId,
      regionId: record.regionId,
      productId: record.productId,
      product: record.product || null,
      quantity: record.quantity,
      quantityCase: record.quantityCase ? Number(record.quantityCase) : null,
      sellingPrice: Number(record.sellingPrice),
      totalValue: Number(record.totalValue),
      sourceSystem: record.sourceSystem,
      sourceReference: record.sourceReference,
      periodYear: record.periodYear,
      periodMonth: record.periodMonth,
      periodWeek: record.periodWeek,
      importedAt: record.importedAt,
      importedById: record.importedById,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
