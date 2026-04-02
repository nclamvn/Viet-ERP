// =============================================================================
// FORECAST ENGINE
// Statistical forecasting models for demand prediction
// =============================================================================

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  getDataExtractorService,
  PreparedForecastData,
  TimeSeriesData,
} from "./data-extractor";
import {
  getMonthlyHolidayFactor,
  getWeeklyHolidayFactor,
  formatPeriod,
  parsePeriod,
  getUpcomingHolidays,
} from "./vn-calendar";

// =============================================================================
// TYPES
// =============================================================================

export interface ForecastPoint {
  period: string;
  periodType: "weekly" | "monthly";
  date: Date;
  forecast: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  factors: ForecastFactors;
}

export interface ForecastFactors {
  baseValue: number;
  trend: number;
  seasonalIndex: number;
  holidayFactor: number;
  holidayNames: string[];
  adjustments: string[];
}

export interface ForecastResult {
  productId: string;
  productSku: string;
  productName: string;
  generatedAt: Date;
  periodType: "weekly" | "monthly";
  model: ForecastModel;
  forecasts: ForecastPoint[];
  metrics: ForecastMetrics;
  recommendations: ForecastRecommendations;
  dataQuality: "good" | "fair" | "poor";
}

export interface ForecastMetrics {
  historicalAvg: number;
  historicalStdDev: number;
  trend: "increasing" | "decreasing" | "stable";
  trendSlope: number;
  seasonality: "strong" | "moderate" | "weak" | "none";
  volatility: "high" | "medium" | "low";
}

export interface ForecastRecommendations {
  safetyStock: {
    current: number;
    recommended: number;
    reason: string;
  };
  reorderPoint: {
    current: number;
    recommended: number;
    reason: string;
  };
  nextPurchase: {
    quantity: number;
    suggestedDate: Date;
    reason: string;
  } | null;
}

export type ForecastModel =
  | "moving_average"
  | "exponential_smoothing"
  | "holt_winters"
  | "ensemble";

export interface ForecastConfig {
  model: ForecastModel;
  periodType: "weekly" | "monthly";
  periodsAhead: number;
  confidenceLevel: number;
  useHolidayAdjustment: boolean;
  useSeasonalAdjustment: boolean;
  smoothingAlpha?: number;
  smoothingBeta?: number;
  smoothingGamma?: number;
}

export const DEFAULT_CONFIG: ForecastConfig = {
  model: "ensemble",
  periodType: "monthly",
  periodsAhead: 12,
  confidenceLevel: 0.8,
  useHolidayAdjustment: true,
  useSeasonalAdjustment: true,
  smoothingAlpha: 0.3,
  smoothingBeta: 0.1,
  smoothingGamma: 0.1,
};

// =============================================================================
// FORECAST ENGINE SERVICE
// =============================================================================

export class ForecastEngine {
  private dataExtractor = getDataExtractorService();

  // ===========================================================================
  // MAIN FORECAST GENERATION
  // ===========================================================================

  /**
   * Generate forecast for a product
   */
  async generateForecast(
    productId: string,
    config: Partial<ForecastConfig> = {},
  ): Promise<ForecastResult | null> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // Get prepared time series data
    const preparedData = await this.dataExtractor.prepareTimeSeriesData(
      productId,
      24,
      cfg.periodType,
    );

    if (!preparedData || preparedData.timeSeries.length < 6) {
      return null;
    }

    const values = preparedData.timeSeries.map((p) => p.value);

    // Generate forecasts based on model
    let forecasts: ForecastPoint[];

    switch (cfg.model) {
      case "moving_average":
        forecasts = this.movingAverageForecast(preparedData, cfg);
        break;
      case "exponential_smoothing":
        forecasts = this.exponentialSmoothingForecast(preparedData, cfg);
        break;
      case "holt_winters":
        forecasts = this.holtWintersForecast(preparedData, cfg);
        break;
      case "ensemble":
      default:
        forecasts = this.ensembleForecast(preparedData, cfg);
        break;
    }

    // Calculate metrics
    const metrics = this.calculateMetrics(values, preparedData.seasonalIndices);

    // Generate recommendations
    const recommendations = await this.generateRecommendations(
      productId,
      forecasts,
      metrics,
    );

    return {
      productId: preparedData.productId,
      productSku: preparedData.productSku,
      productName: preparedData.productName,
      generatedAt: new Date(),
      periodType: cfg.periodType,
      model: cfg.model,
      forecasts,
      metrics,
      recommendations,
      dataQuality: preparedData.dataQuality,
    };
  }

  // ===========================================================================
  // FORECASTING MODELS
  // ===========================================================================

  /**
   * Simple Moving Average forecast
   */
  private movingAverageForecast(
    data: PreparedForecastData,
    config: ForecastConfig,
  ): ForecastPoint[] {
    const values = data.timeSeries.map((p) => p.value);
    const windowSize = Math.min(6, Math.floor(values.length / 2));

    // Calculate recent average
    const recentValues = values.slice(-windowSize);
    const baseValue = recentValues.reduce((a, b) => a + b, 0) / windowSize;

    // Calculate standard deviation for confidence intervals
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Generate forecasts
    const lastDate = data.timeSeries[data.timeSeries.length - 1].date;
    const forecasts: ForecastPoint[] = [];

    for (let i = 1; i <= config.periodsAhead; i++) {
      const forecastDate = this.getNextPeriodDate(
        lastDate,
        i,
        config.periodType,
      );
      const period = formatPeriod(forecastDate, config.periodType);

      // Apply adjustments
      let forecastValue = baseValue;
      const factors: ForecastFactors = {
        baseValue,
        trend: 0,
        seasonalIndex: 1,
        holidayFactor: 1,
        holidayNames: [],
        adjustments: [],
      };

      // Seasonal adjustment
      if (config.useSeasonalAdjustment && config.periodType === "monthly") {
        const month = forecastDate.getMonth() + 1;
        const seasonalIndex = data.seasonalIndices[month] || 1;
        forecastValue *= seasonalIndex;
        factors.seasonalIndex = seasonalIndex;
        if (seasonalIndex !== 1) {
          factors.adjustments.push(
            `Seasonal: ${seasonalIndex > 1 ? "+" : ""}${Math.round((seasonalIndex - 1) * 100)}%`,
          );
        }
      }

      // Holiday adjustment
      if (config.useHolidayAdjustment) {
        const holidayFactor =
          config.periodType === "monthly"
            ? getMonthlyHolidayFactor(
                forecastDate.getFullYear(),
                forecastDate.getMonth() + 1,
              )
            : getWeeklyHolidayFactor(forecastDate);
        forecastValue *= holidayFactor;
        factors.holidayFactor = holidayFactor;
        if (holidayFactor !== 1) {
          factors.adjustments.push(
            `Holiday: ${holidayFactor > 1 ? "+" : ""}${Math.round((holidayFactor - 1) * 100)}%`,
          );
        }
      }

      // Confidence interval widens with forecast horizon
      const horizonFactor = 1 + (i - 1) * 0.1;
      const zScore = this.getZScore(config.confidenceLevel);

      forecasts.push({
        period,
        periodType: config.periodType,
        date: forecastDate,
        forecast: Math.round(Math.max(0, forecastValue)),
        lowerBound: Math.round(
          Math.max(0, forecastValue - zScore * stdDev * horizonFactor),
        ),
        upperBound: Math.round(forecastValue + zScore * stdDev * horizonFactor),
        confidence: Math.max(0.5, 1 - (i - 1) * 0.05),
        factors,
      });
    }

    return forecasts;
  }

  /**
   * Exponential Smoothing forecast (Simple/Double)
   */
  private exponentialSmoothingForecast(
    data: PreparedForecastData,
    config: ForecastConfig,
  ): ForecastPoint[] {
    const values = data.timeSeries.map((p) => p.value);
    const alpha = config.smoothingAlpha || 0.3;
    const beta = config.smoothingBeta || 0.1;

    // Initialize
    let level = values[0];
    let trend = values.length > 1 ? values[1] - values[0] : 0;

    // Apply double exponential smoothing
    for (let i = 1; i < values.length; i++) {
      const prevLevel = level;
      level = alpha * values[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    // Calculate residuals for confidence intervals
    const residuals: number[] = [];
    let smoothedValue = values[0];
    let smoothedTrend = values.length > 1 ? values[1] - values[0] : 0;

    for (let i = 1; i < values.length; i++) {
      const predicted = smoothedValue + smoothedTrend;
      residuals.push(values[i] - predicted);

      const prevSmoothed = smoothedValue;
      smoothedValue =
        alpha * values[i] + (1 - alpha) * (smoothedValue + smoothedTrend);
      smoothedTrend =
        beta * (smoothedValue - prevSmoothed) + (1 - beta) * smoothedTrend;
    }

    const residualStdDev = this.calculateStdDev(residuals);

    // Generate forecasts
    const lastDate = data.timeSeries[data.timeSeries.length - 1].date;
    const forecasts: ForecastPoint[] = [];

    for (let i = 1; i <= config.periodsAhead; i++) {
      const forecastDate = this.getNextPeriodDate(
        lastDate,
        i,
        config.periodType,
      );
      const period = formatPeriod(forecastDate, config.periodType);

      let forecastValue = level + i * trend;
      const factors: ForecastFactors = {
        baseValue: level,
        trend: trend * i,
        seasonalIndex: 1,
        holidayFactor: 1,
        holidayNames: [],
        adjustments: [
          `Trend: ${trend >= 0 ? "+" : ""}${Math.round(trend * i)}`,
        ],
      };

      // Seasonal adjustment
      if (config.useSeasonalAdjustment && config.periodType === "monthly") {
        const month = forecastDate.getMonth() + 1;
        const seasonalIndex = data.seasonalIndices[month] || 1;
        forecastValue *= seasonalIndex;
        factors.seasonalIndex = seasonalIndex;
      }

      // Holiday adjustment
      if (config.useHolidayAdjustment) {
        const holidayFactor =
          config.periodType === "monthly"
            ? getMonthlyHolidayFactor(
                forecastDate.getFullYear(),
                forecastDate.getMonth() + 1,
              )
            : getWeeklyHolidayFactor(forecastDate);
        forecastValue *= holidayFactor;
        factors.holidayFactor = holidayFactor;
      }

      const horizonFactor = Math.sqrt(i);
      const zScore = this.getZScore(config.confidenceLevel);

      forecasts.push({
        period,
        periodType: config.periodType,
        date: forecastDate,
        forecast: Math.round(Math.max(0, forecastValue)),
        lowerBound: Math.round(
          Math.max(0, forecastValue - zScore * residualStdDev * horizonFactor),
        ),
        upperBound: Math.round(
          forecastValue + zScore * residualStdDev * horizonFactor,
        ),
        confidence: Math.max(0.5, 1 - (i - 1) * 0.04),
        factors,
      });
    }

    return forecasts;
  }

  /**
   * Holt-Winters Triple Exponential Smoothing
   */
  private holtWintersForecast(
    data: PreparedForecastData,
    config: ForecastConfig,
  ): ForecastPoint[] {
    const values = data.timeSeries.map((p) => p.value);
    const alpha = config.smoothingAlpha || 0.3;
    const beta = config.smoothingBeta || 0.1;
    const gamma = config.smoothingGamma || 0.1;

    const seasonLength = config.periodType === "monthly" ? 12 : 52;

    // Not enough data for seasonal model
    if (values.length < seasonLength * 2) {
      return this.exponentialSmoothingForecast(data, config);
    }

    // Initialize seasonal indices
    const seasonalIndices: number[] = new Array(seasonLength).fill(1);
    const firstSeasonAvg =
      values.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;

    for (let i = 0; i < seasonLength; i++) {
      seasonalIndices[i] = firstSeasonAvg > 0 ? values[i] / firstSeasonAvg : 1;
    }

    // Initialize level and trend
    let level = firstSeasonAvg;
    let trend =
      (values.slice(seasonLength, 2 * seasonLength).reduce((a, b) => a + b, 0) /
        seasonLength -
        firstSeasonAvg) /
      seasonLength;

    // Apply Holt-Winters
    const residuals: number[] = [];

    for (let i = seasonLength; i < values.length; i++) {
      const seasonIdx = i % seasonLength;
      const prevLevel = level;

      // Multiplicative seasonality
      level =
        alpha * (values[i] / seasonalIndices[seasonIdx]) +
        (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      seasonalIndices[seasonIdx] =
        gamma * (values[i] / level) + (1 - gamma) * seasonalIndices[seasonIdx];

      // Track residuals
      const predicted = (prevLevel + trend) * seasonalIndices[seasonIdx];
      residuals.push(values[i] - predicted);
    }

    const residualStdDev = this.calculateStdDev(residuals);

    // Generate forecasts
    const lastDate = data.timeSeries[data.timeSeries.length - 1].date;
    const forecasts: ForecastPoint[] = [];

    for (let i = 1; i <= config.periodsAhead; i++) {
      const forecastDate = this.getNextPeriodDate(
        lastDate,
        i,
        config.periodType,
      );
      const period = formatPeriod(forecastDate, config.periodType);

      const seasonIdx = (data.timeSeries.length + i - 1) % seasonLength;
      let forecastValue = (level + i * trend) * seasonalIndices[seasonIdx];

      const factors: ForecastFactors = {
        baseValue: level,
        trend: trend * i,
        seasonalIndex: seasonalIndices[seasonIdx],
        holidayFactor: 1,
        holidayNames: [],
        adjustments: [],
      };

      // Holiday adjustment (on top of seasonal)
      if (config.useHolidayAdjustment) {
        const holidayFactor =
          config.periodType === "monthly"
            ? getMonthlyHolidayFactor(
                forecastDate.getFullYear(),
                forecastDate.getMonth() + 1,
              )
            : getWeeklyHolidayFactor(forecastDate);
        forecastValue *= holidayFactor;
        factors.holidayFactor = holidayFactor;
      }

      const horizonFactor = Math.sqrt(i);
      const zScore = this.getZScore(config.confidenceLevel);

      forecasts.push({
        period,
        periodType: config.periodType,
        date: forecastDate,
        forecast: Math.round(Math.max(0, forecastValue)),
        lowerBound: Math.round(
          Math.max(0, forecastValue - zScore * residualStdDev * horizonFactor),
        ),
        upperBound: Math.round(
          forecastValue + zScore * residualStdDev * horizonFactor,
        ),
        confidence: Math.max(0.5, 1 - (i - 1) * 0.03),
        factors,
      });
    }

    return forecasts;
  }

  /**
   * Ensemble forecast combining multiple models
   */
  private ensembleForecast(
    data: PreparedForecastData,
    config: ForecastConfig,
  ): ForecastPoint[] {
    // Generate forecasts from each model
    const maForecasts = this.movingAverageForecast(data, config);
    const esForecasts = this.exponentialSmoothingForecast(data, config);
    const hwForecasts = this.holtWintersForecast(data, config);

    // Weighted average (weights based on data quality and length)
    const weights = this.calculateModelWeights(data);

    const ensembleForecasts: ForecastPoint[] = [];

    for (let i = 0; i < config.periodsAhead; i++) {
      const ma = maForecasts[i];
      const es = esForecasts[i];
      const hw = hwForecasts[i];

      const forecast = Math.round(
        ma.forecast * weights.ma +
          es.forecast * weights.es +
          hw.forecast * weights.hw,
      );
      const lowerBound = Math.round(
        ma.lowerBound * weights.ma +
          es.lowerBound * weights.es +
          hw.lowerBound * weights.hw,
      );
      const upperBound = Math.round(
        ma.upperBound * weights.ma +
          es.upperBound * weights.es +
          hw.upperBound * weights.hw,
      );
      const confidence =
        ma.confidence * weights.ma +
        es.confidence * weights.es +
        hw.confidence * weights.hw;

      // Combine factors (use exponential smoothing factors as primary)
      const factors: ForecastFactors = {
        ...es.factors,
        adjustments: [
          `Ensemble: MA(${Math.round(weights.ma * 100)}%) + ES(${Math.round(weights.es * 100)}%) + HW(${Math.round(weights.hw * 100)}%)`,
          ...es.factors.adjustments,
        ],
      };

      ensembleForecasts.push({
        period: ma.period,
        periodType: config.periodType,
        date: ma.date,
        forecast: Math.max(0, forecast),
        lowerBound: Math.max(0, lowerBound),
        upperBound,
        confidence,
        factors,
      });
    }

    return ensembleForecasts;
  }

  // ===========================================================================
  // METRICS & RECOMMENDATIONS
  // ===========================================================================

  private calculateMetrics(
    values: number[],
    seasonalIndices: Record<number, number>,
  ): ForecastMetrics {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Trend
    const trendSlope = this.calculateLinearTrendSlope(values);
    const normalizedTrend = mean > 0 ? trendSlope / mean : 0;

    let trend: "increasing" | "decreasing" | "stable";
    if (normalizedTrend > 0.02) trend = "increasing";
    else if (normalizedTrend < -0.02) trend = "decreasing";
    else trend = "stable";

    // Seasonality strength
    const seasonalValues = Object.values(seasonalIndices);
    const seasonalRange =
      Math.max(...seasonalValues) - Math.min(...seasonalValues);

    let seasonality: "strong" | "moderate" | "weak" | "none";
    if (seasonalRange > 0.5) seasonality = "strong";
    else if (seasonalRange > 0.25) seasonality = "moderate";
    else if (seasonalRange > 0.1) seasonality = "weak";
    else seasonality = "none";

    // Volatility (coefficient of variation)
    const cv = mean > 0 ? stdDev / mean : 0;

    let volatility: "high" | "medium" | "low";
    if (cv > 0.5) volatility = "high";
    else if (cv > 0.25) volatility = "medium";
    else volatility = "low";

    return {
      historicalAvg: Math.round(mean),
      historicalStdDev: Math.round(stdDev),
      trend,
      trendSlope: Math.round(trendSlope * 100) / 100,
      seasonality,
      volatility,
    };
  }

  private async generateRecommendations(
    productId: string,
    forecasts: ForecastPoint[],
    metrics: ForecastMetrics,
  ): Promise<ForecastRecommendations> {
    // Get current inventory settings
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
      },
    });

    // Calculate recommended values based on forecasts
    const avgForecast =
      forecasts.reduce((a, f) => a + f.forecast, 0) / forecasts.length;
    const maxForecast = Math.max(...forecasts.map((f) => f.forecast));
    const avgUpperBound =
      forecasts.reduce((a, f) => a + f.upperBound, 0) / forecasts.length;

    // Safety stock calculation (based on service level and volatility)
    const safetyStockMultiplier =
      metrics.volatility === "high"
        ? 2.5
        : metrics.volatility === "medium"
          ? 1.5
          : 1.0;
    const recommendedSafetyStock = Math.round(
      metrics.historicalStdDev * safetyStockMultiplier,
    );

    // Reorder point (average demand during lead time + safety stock)
    // Assume 2-week lead time for now
    const weeksLeadTime = 2;
    const weeklyDemand = avgForecast / 4; // Approximate weekly from monthly
    const recommendedReorderPoint = Math.round(
      weeklyDemand * weeksLeadTime + recommendedSafetyStock,
    );

    // Next purchase suggestion
    let nextPurchase: ForecastRecommendations["nextPurchase"] = null;

    // Find upcoming high demand periods
    const upcomingHolidays = getUpcomingHolidays(3);
    const highDemandPeriod = forecasts.find(
      (f) => f.forecast > avgForecast * 1.2,
    );

    if (highDemandPeriod) {
      const orderDate = new Date(highDemandPeriod.date);
      orderDate.setDate(orderDate.getDate() - 14); // 2 weeks before

      nextPurchase = {
        quantity: Math.round(highDemandPeriod.upperBound - avgForecast),
        suggestedDate: orderDate,
        reason: `Prepare for high demand in ${highDemandPeriod.period}${
          upcomingHolidays.length > 0 ? ` (${upcomingHolidays[0].nameVi})` : ""
        }`,
      };
    }

    return {
      safetyStock: {
        current: 0, // Would need inventory data
        recommended: recommendedSafetyStock,
        reason:
          metrics.volatility === "high"
            ? "High demand volatility requires larger buffer"
            : metrics.volatility === "medium"
              ? "Moderate volatility, standard buffer"
              : "Low volatility, minimal buffer needed",
      },
      reorderPoint: {
        current: 0,
        recommended: recommendedReorderPoint,
        reason: `Based on ${weeksLeadTime}-week lead time + safety stock`,
      },
      nextPurchase,
    };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private getNextPeriodDate(
    lastDate: Date,
    periodsAhead: number,
    periodType: "weekly" | "monthly",
  ): Date {
    const result = new Date(lastDate);

    if (periodType === "monthly") {
      result.setMonth(result.getMonth() + periodsAhead);
      result.setDate(1);
    } else {
      result.setDate(result.getDate() + periodsAhead * 7);
    }

    return result;
  }

  private getZScore(confidenceLevel: number): number {
    // Approximate z-scores for common confidence levels
    if (confidenceLevel >= 0.99) return 2.576;
    if (confidenceLevel >= 0.95) return 1.96;
    if (confidenceLevel >= 0.9) return 1.645;
    if (confidenceLevel >= 0.8) return 1.282;
    return 1.0;
  }

  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateLinearTrendSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0,
      sumY = 0,
      sumXY = 0,
      sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return isNaN(slope) ? 0 : slope;
  }

  private calculateModelWeights(data: PreparedForecastData): {
    ma: number;
    es: number;
    hw: number;
  } {
    const dataLength = data.timeSeries.length;
    const dataQuality = data.dataQuality;

    // Base weights
    let maWeight = 0.33;
    let esWeight = 0.34;
    let hwWeight = 0.33;

    // Adjust for data length
    if (dataLength < 12) {
      // Not enough for seasonal - reduce HW
      maWeight = 0.4;
      esWeight = 0.45;
      hwWeight = 0.15;
    } else if (dataLength >= 24) {
      // Good data for seasonal - increase HW
      maWeight = 0.25;
      esWeight = 0.35;
      hwWeight = 0.4;
    }

    // Adjust for data quality
    if (dataQuality === "poor") {
      // Poor quality - prefer simpler models
      maWeight += 0.1;
      hwWeight -= 0.1;
    }

    // Normalize
    const total = maWeight + esWeight + hwWeight;
    return {
      ma: maWeight / total,
      es: esWeight / total,
      hw: hwWeight / total,
    };
  }

  // ===========================================================================
  // SAVE FORECAST TO DATABASE
  // ===========================================================================

  async saveForecast(result: ForecastResult): Promise<void> {
    for (const forecast of result.forecasts) {
      await prisma.demandForecast.upsert({
        where: {
          productId_period_periodType: {
            productId: result.productId,
            period: forecast.period,
            periodType: result.periodType,
          },
        },
        update: {
          forecastQty: forecast.forecast,
          lowerBound: forecast.lowerBound,
          upperBound: forecast.upperBound,
          confidence: forecast.confidence,
          model: result.model,
          factors:
            forecast.factors as unknown as import(".prisma/mrp-client").Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
        create: {
          productId: result.productId,
          period: forecast.period,
          periodType: result.periodType,
          forecastQty: forecast.forecast,
          lowerBound: forecast.lowerBound,
          upperBound: forecast.upperBound,
          confidence: forecast.confidence,
          model: result.model,
          factors:
            forecast.factors as unknown as import(".prisma/mrp-client").Prisma.InputJsonValue,
        },
      });
    }
  }

  // ===========================================================================
  // BULK FORECAST GENERATION
  // ===========================================================================

  async generateAllForecasts(config: Partial<ForecastConfig> = {}): Promise<{
    success: number;
    failed: number;
    results: ForecastResult[];
  }> {
    const products = await prisma.product.findMany({
      where: { status: "active" },
      select: { id: true },
    });

    const results: ForecastResult[] = [];
    let success = 0;
    let failed = 0;

    for (const product of products) {
      try {
        const forecast = await this.generateForecast(product.id, config);
        if (forecast) {
          await this.saveForecast(forecast);
          results.push(forecast);
          success++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.logError(
          error instanceof Error ? error : new Error(String(error)),
          { context: "forecast-engine", productId: product.id },
        );
        failed++;
      }
    }

    return { success, failed, results };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let forecastEngineInstance: ForecastEngine | null = null;

export function getForecastEngine(): ForecastEngine {
  if (!forecastEngineInstance) {
    forecastEngineInstance = new ForecastEngine();
  }
  return forecastEngineInstance;
}

export default ForecastEngine;
