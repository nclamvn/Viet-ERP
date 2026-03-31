// ============================================================
// @vierp/ai-copilot — LIPHOCO Costing Module
// ============================================================
//
// Tích hợp LIPHOCO Costing Skill v2 vào hệ thống AI Copilot
// Module này xử lý: BOM extraction → Fabrication classification →
// Cost calculation → Quotation generation
//
// Sử dụng: import { costingModule } from '@vierp/ai-copilot/modules/costing'
// ============================================================

import type { CopilotTool, ToolCall, ToolResult } from '../types';

// ─── Constants: Đơn giá gia công (cập nhật: 2026-03-11) ─────

export const FABRICATION_RATES = {
  laserCut: { rate: 130, unit: 'VNĐ/mm', description: 'Cắt laser — chiều dài đường cắt' },
  bending: { rate: 17, unit: 'VNĐ/giây', description: 'Chấn — ~120 giây/nhát' },
  tubeCut: { rate: 17, unit: 'VNĐ/giây', description: 'Cắt hộp/ống — ~60-90 giây/nhát' },
  jigSetup: { rate: 17, unit: 'VNĐ/giây', description: 'Gá hàn — phụ thuộc độ phức tạp' },
  weldMaterial: { rate: 15, unit: 'VNĐ/mm', description: 'CP hàn — dây hàn, gas' },
  weldLabor: { rate: 17, unit: 'VNĐ/mm', description: 'Công hàn — nhân công' },
  cleaning: { rate: 17, unit: 'VNĐ/giây', description: 'Vệ sinh / mài sau hàn' },
  latheCut: { rate: 17, unit: 'VNĐ/giây', description: 'Cắt láp chi tiết tiện' },
  lathe: { rate: 50, unit: 'VNĐ/giây', description: 'Tiện CNC/thường' },
  latheCastPipe: { rate: 35, unit: 'VNĐ/giây', description: 'Tiện ống đúc' },
  rollForm: { rate: 17, unit: 'VNĐ/giây', description: 'Uốn/roll tròn' },
  deburr: { rate: 17, unit: 'VNĐ/giây', description: 'Mài cạnh bén sau cắt laser' },
} as const;

export const MATERIAL_RATES = {
  steelBlackSheet: { rate: 16500, unit: 'VNĐ/kg', description: 'Thép tấm đen SS400/CT3' },
  steelBlackTube: { rate: 18500, unit: 'VNĐ/kg', description: 'Thép hộp/ống đen' },
  steelGalvSheet: { rate: 19546, unit: 'VNĐ/kg', description: 'Thép tấm kẽm GI' },
  steelGalvTube: { rate: 18182, unit: 'VNĐ/kg', description: 'Thép hộp kẽm' },
  steelThickPlate: { rate: 16500, unit: 'VNĐ/kg', description: 'Thép tấm dày ≥6mm' },
} as const;

export const FIXED_PARAMS = {
  overhead: 0.20,         // CPCĐ 20%
  profitMargin: 0.10,     // Lợi nhuận 10%
  exchangeRate: 24500,    // USD/VNĐ
  wasteTube: 0.015,       // Hao hụt hộp/ống 1.5%
  wasteSheet: 0.05,       // Hao hụt tấm 5%
  domesticShipping: 600,  // VNĐ/kg
  packaging: 600,         // VNĐ/kg
  fob: 1000,              // VNĐ/kg
  steelDensity: 7.85,     // g/cm³
} as const;

// ─── Types ───────────────────────────────────────────────────

export type FabricationMethod =
  | 'laser_cut'
  | 'tube_cut'
  | 'bending'
  | 'welding'
  | 'jig_setup'
  | 'cleaning'
  | 'lathe'
  | 'roll_form'
  | 'progressive_die';

export type SurfaceFinish =
  | 'powder_coat'
  | 'hot_dip_galvanized'
  | 'electro_zinc'
  | 'none';

export type MaterialType =
  | 'steel_black_sheet'
  | 'steel_black_tube'
  | 'steel_galv_sheet'
  | 'steel_galv_tube'
  | 'steel_thick_plate';

export interface BOMItem {
  itemNo: string;
  partName: string;
  material: MaterialType;
  quantity: number;
  dimensions: {
    length?: number;   // mm
    width?: number;    // mm
    thickness?: number; // mm
    diameter?: number;  // mm (for tubes)
  };
  weightPerUnit: number; // kg
  fabricationMethods: FabricationMethod[];
}

export interface CostBreakdown {
  materialCost: number;      // VNĐ
  fabricationCost: number;   // VNĐ
  surfaceFinishCost: number; // VNĐ
  packagingFOB: number;      // VNĐ
  productionCost: number;    // VNĐ (sum of above)
  overhead: number;          // VNĐ
  profit: number;            // VNĐ
  sellPriceVND: number;      // VNĐ
  sellPriceUSD: number;      // USD
  pricePerKg: number;        // VNĐ/kg
}

export interface QuotationResult {
  projectName: string;
  customer: string;
  bom: BOMItem[];
  costPerUnit: CostBreakdown;
  totalWeight: number;       // kg
  quantity: number;
  totalCost: CostBreakdown;
  generatedAt: Date;
  notes: string[];
}

// ─── Pricing Profile Overrides ───────────────────────────────
// Từng khách hàng có cơ cấu giá khác nhau

export interface PricingProfile {
  name: string;
  overhead: number;      // CPCĐ %
  profitMargin: number;  // LN %
  notes: string;
}

export const PRICING_PROFILES: Record<string, PricingProfile> = {
  ballymore: {
    name: 'Ballymore (existing)',
    overhead: 0.15,
    profitMargin: 0.05,
    notes: 'Khách cũ: CPCĐ 15% + LN 5% (÷0.80)',
  },
  newCustomer: {
    name: 'Khách mới',
    overhead: 0.20,
    profitMargin: 0.10,
    notes: 'Khách mới: CPCĐ 20% + LN 10% (÷0.70)',
  },
  darioHomy: {
    name: 'Dario/Homy/NSP',
    overhead: 0,
    profitMargin: 0,
    notes: 'Flat rate ~$1.55/kg EXW (~39,500 VNĐ/kg)',
  },
  richmond: {
    name: 'Richmond (Australia)',
    overhead: 0,
    profitMargin: 0.25,
    notes: 'NVL 28K/kg + 15% waste + Pkg-FOB 6,400/kg + Labor 12K/kg → Sell = Prod ÷ 0.75',
  },
};

// ─── Core Calculation Functions ──────────────────────────────

/**
 * Tính giá bán theo công thức LIPHOCO:
 * GIÁ BÁN = GIÁ SX ÷ (1 − CPCĐ% − LN%)
 */
export function calculateSellPrice(
  productionCost: number,
  profile: PricingProfile = PRICING_PROFILES.newCustomer
): { sellPrice: number; overhead: number; profit: number } {
  const divisor = 1 - profile.overhead - profile.profitMargin;
  const sellPrice = productionCost / divisor;
  const overhead = sellPrice * profile.overhead;
  const profit = sellPrice * profile.profitMargin;
  return { sellPrice, overhead, profit };
}

/**
 * Tính trọng lượng thép hộp/ống theo phương pháp chu vi
 * W (kg) = Chu vi (mm) × Dày (mm) × Dài (mm) × 7.85 / 1,000,000
 */
export function calcTubeWeight(
  perimeterMm: number,
  thicknessMm: number,
  lengthMm: number
): number {
  return (perimeterMm * thicknessMm * lengthMm * FIXED_PARAMS.steelDensity) / 1_000_000;
}

/**
 * Tính trọng lượng thép tấm
 * W (kg) = Dài (mm) × Rộng (mm) × Dày (mm) × 7.85 / 1,000,000
 */
export function calcSheetWeight(
  lengthMm: number,
  widthMm: number,
  thicknessMm: number
): number {
  return (lengthMm * widthMm * thicknessMm * FIXED_PARAMS.steelDensity) / 1_000_000;
}

/**
 * Tính chi phí NVL bao gồm hao hụt
 */
export function calcMaterialCost(
  weightKg: number,
  materialType: MaterialType,
  quantity: number
): number {
  const rateMap: Record<MaterialType, { rate: number; waste: number }> = {
    steel_black_sheet: { rate: MATERIAL_RATES.steelBlackSheet.rate, waste: FIXED_PARAMS.wasteSheet },
    steel_black_tube: { rate: MATERIAL_RATES.steelBlackTube.rate, waste: FIXED_PARAMS.wasteTube },
    steel_galv_sheet: { rate: MATERIAL_RATES.steelGalvSheet.rate, waste: FIXED_PARAMS.wasteSheet },
    steel_galv_tube: { rate: MATERIAL_RATES.steelGalvTube.rate, waste: FIXED_PARAMS.wasteTube },
    steel_thick_plate: { rate: MATERIAL_RATES.steelThickPlate.rate, waste: FIXED_PARAMS.wasteSheet },
  };

  const { rate, waste } = rateMap[materialType];
  return weightKg * (1 + waste) * rate * quantity;
}

// ─── Copilot Tool Definition ─────────────────────────────────
// Đăng ký tool này vào ai-copilot engine để Claude gọi được

export const costingTools: CopilotTool[] = [
  {
    name: 'calculate_production_cost',
    description: 'Tính giá thành sản xuất từ BOM items đã bóc tách',
    inputSchema: {
      type: 'object',
      properties: {
        bom: { type: 'array', description: 'Danh sách BOM items' },
        surfaceFinish: { type: 'string', enum: ['powder_coat', 'hot_dip_galvanized', 'electro_zinc', 'none'] },
        quantity: { type: 'number', description: 'Số lượng sản xuất' },
        pricingProfile: { type: 'string', enum: ['ballymore', 'newCustomer', 'darioHomy', 'richmond'] },
      },
      required: ['bom', 'quantity'],
    },
  },
  {
    name: 'extract_bom_from_drawing',
    description: 'Bóc tách BOM từ bản vẽ kỹ thuật 2D (PDF/Image)',
    inputSchema: {
      type: 'object',
      properties: {
        drawingUrl: { type: 'string', description: 'URL hoặc path tới file bản vẽ' },
        projectName: { type: 'string', description: 'Tên dự án/sản phẩm' },
      },
      required: ['drawingUrl'],
    },
  },
  {
    name: 'generate_quotation_excel',
    description: 'Xuất file Excel báo giá theo format LIPHOCO',
    inputSchema: {
      type: 'object',
      properties: {
        quotation: { type: 'object', description: 'Kết quả tính giá QuotationResult' },
        customerName: { type: 'string' },
        language: { type: 'string', enum: ['vi', 'en'] },
      },
      required: ['quotation', 'customerName'],
    },
  },
];

// ─── Module Registration ─────────────────────────────────────

export const costingModule = {
  id: 'costing' as const,
  name: 'LIPHOCO Costing',
  description: 'Tính giá thành OEM — từ bản vẽ đến báo giá',
  tools: costingTools,
  systemPrompt: `Bạn là LP Copilot — trợ lý AI chuyên tính giá thành cho LIPHOCO.
Quy trình: Bản vẽ 2D → Bóc tách BOM → Phân loại gia công → Tính giá → Báo giá Excel.
QUAN TRỌNG: Luôn phân loại phương pháp gia công TRƯỚC KHI ước lượng kích thước blank.
Công thức: GIÁ BÁN = GIÁ SX ÷ (1 − CPCĐ% − LN%). Tỷ giá: 24,500 VNĐ/USD.`,
};
