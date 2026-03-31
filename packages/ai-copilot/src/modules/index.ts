// ============================================================
// @vierp/ai-copilot — Module-Specific Assistants
// Each module gets a specialized assistant with domain knowledge,
// tools, and context builders
// ============================================================

import type { ModuleAssistant, ConversationContext, CopilotTool } from '../types';
import { buildERPContext } from '../core/context-builder';

// ==================== HRM Assistant ====================

export const hrmAssistant: ModuleAssistant = {
  module: 'hrm',
  systemPrompt: `Bạn là trợ lý quản lý nhân sự (HRM) chuyên nghiệp.
Chuyên môn: Quản lý nhân viên, chấm công, nghỉ phép, tính lương, tuyển dụng, KPI, đào tạo.
Thuật ngữ: BHXH (bảo hiểm xã hội), BHYT (bảo hiểm y tế), BHTN (bảo hiểm thất nghiệp),
thuế TNCN (thuế thu nhập cá nhân), phụ cấp, trợ cấp, hợp đồng lao động.
Quy định: Bộ luật Lao động 2019, Luật BHXH, Luật Thuế TNCN.`,

  tools: [
    createQueryTool('hrm_search_employees', 'Tìm kiếm nhân viên theo tên, mã, phòng ban', {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Tên hoặc mã nhân viên' },
        department: { type: 'string', description: 'Phòng ban' },
        status: { type: 'string', enum: ['active', 'inactive', 'terminated'] },
      },
      required: ['query'],
    }),
    createQueryTool('hrm_leave_balance', 'Kiểm tra số ngày phép còn lại của nhân viên', {
      type: 'object',
      properties: {
        employeeId: { type: 'string' },
        year: { type: 'number' },
      },
      required: ['employeeId'],
    }),
    createQueryTool('hrm_payroll_summary', 'Tóm tắt bảng lương theo kỳ', {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Kỳ lương (e.g., 2026-03)' },
        department: { type: 'string' },
      },
      required: ['period'],
    }),
  ],

  contextBuilder: async (context) => {
    const { contextString } = await buildERPContext(context);
    return `Module: Quản lý nhân sự (HRM)\n${contextString}`;
  },
};

// ==================== Accounting Assistant ====================

export const accountingAssistant: ModuleAssistant = {
  module: 'accounting',
  systemPrompt: `Bạn là trợ lý kế toán chuyên nghiệp theo chuẩn Việt Nam.
Chuyên môn: Sổ cái (GL), bút toán, công nợ AP/AR, hóa đơn điện tử, thuế, BCTC.
Chuẩn mực: VAS (Thông tư 200/TT133), Nghị định 123/2020 (hóa đơn), Luật Thuế.
Hệ thống tài khoản: Loại 1-9 theo TT200 (111-Tiền mặt, 131-Phải thu, 331-Phải trả, 511-DT, 632-GVHB, etc.)
Thuế suất: VAT 10%/8%/5%/0%, TNDN 20%, TNCN luỹ tiến 5-35%.`,

  tools: [
    createQueryTool('acc_trial_balance', 'Lấy bảng cân đối phát sinh', {
      type: 'object',
      properties: {
        periodStart: { type: 'string' },
        periodEnd: { type: 'string' },
        accountGroup: { type: 'string', description: 'GROUP_1 to GROUP_9' },
      },
      required: ['periodStart', 'periodEnd'],
    }),
    createQueryTool('acc_journal_search', 'Tìm bút toán theo điều kiện', {
      type: 'object',
      properties: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        accountNumber: { type: 'string' },
        journalType: { type: 'string' },
        status: { type: 'string' },
      },
    }),
    createQueryTool('acc_aging_report', 'Báo cáo tuổi nợ AP hoặc AR', {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['AP', 'AR'] },
        asOfDate: { type: 'string' },
      },
      required: ['type'],
    }),
    createQueryTool('acc_tax_summary', 'Tóm tắt tình hình thuế', {
      type: 'object',
      properties: {
        taxType: { type: 'string', enum: ['VAT', 'CIT', 'PIT'] },
        period: { type: 'string' },
      },
      required: ['taxType', 'period'],
    }),
  ],

  contextBuilder: async (context) => {
    const { contextString } = await buildERPContext(context);
    return `Module: Kế toán & Tài chính\nChuẩn mực: VAS TT200\n${contextString}`;
  },
};

// ==================== MRP Assistant ====================

export const mrpAssistant: ModuleAssistant = {
  module: 'mrp',
  systemPrompt: `Bạn là trợ lý quản lý sản xuất (MRP) chuyên nghiệp.
Chuyên môn: Kế hoạch sản xuất, BOM, quản lý kho, mua hàng, costing, chất lượng.
Thuật ngữ: BOM (Bill of Materials), WO (Work Order), PO (Purchase Order),
MPS (Master Production Schedule), MRP (Material Requirements Planning),
WIP (Work In Progress), QC (Quality Control).`,

  tools: [
    createQueryTool('mrp_inventory_check', 'Kiểm tra tồn kho vật tư/thành phẩm', {
      type: 'object',
      properties: {
        productCode: { type: 'string' },
        warehouseId: { type: 'string' },
      },
      required: ['productCode'],
    }),
    createQueryTool('mrp_production_status', 'Trạng thái lệnh sản xuất', {
      type: 'object',
      properties: {
        workOrderNumber: { type: 'string' },
        status: { type: 'string', enum: ['planned', 'in_progress', 'completed', 'cancelled'] },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
      },
    }),
    createQueryTool('mrp_bom_lookup', 'Tra cứu BOM sản phẩm', {
      type: 'object',
      properties: {
        productCode: { type: 'string' },
        level: { type: 'number', description: 'BOM level depth (default: all)' },
      },
      required: ['productCode'],
    }),
  ],

  contextBuilder: async (context) => {
    const { contextString } = await buildERPContext(context);
    return `Module: Quản lý sản xuất (MRP)\n${contextString}`;
  },
};

// ==================== CRM Assistant ====================

export const crmAssistant: ModuleAssistant = {
  module: 'crm',
  systemPrompt: `Bạn là trợ lý quản lý quan hệ khách hàng (CRM) chuyên nghiệp.
Chuyên môn: Quản lý khách hàng, cơ hội kinh doanh (deals), báo giá, đơn hàng, chiến dịch marketing.
Pipeline: Lead → Qualified → Proposal → Negotiation → Won/Lost.`,

  tools: [
    createQueryTool('crm_customer_search', 'Tìm kiếm khách hàng', {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', enum: ['individual', 'company'] },
        status: { type: 'string' },
      },
      required: ['query'],
    }),
    createQueryTool('crm_pipeline_summary', 'Tóm tắt pipeline bán hàng', {
      type: 'object',
      properties: {
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        ownerId: { type: 'string' },
      },
    }),
    createQueryTool('crm_revenue_report', 'Báo cáo doanh thu', {
      type: 'object',
      properties: {
        period: { type: 'string' },
        groupBy: { type: 'string', enum: ['customer', 'product', 'salesperson', 'region'] },
      },
      required: ['period'],
    }),
  ],

  contextBuilder: async (context) => {
    const { contextString } = await buildERPContext(context);
    return `Module: Quản lý khách hàng (CRM)\n${contextString}`;
  },
};

// ==================== General Assistant ====================

export const generalAssistant: ModuleAssistant = {
  module: 'general',
  systemPrompt: `Bạn là trợ lý tổng hợp cho hệ thống ERP.
Có thể hỗ trợ các câu hỏi chung về hệ thống, điều hướng giữa các module,
và cung cấp tổng quan về tình hình doanh nghiệp.`,

  tools: [
    createQueryTool('erp_dashboard', 'Lấy dữ liệu tổng quan dashboard', {
      type: 'object',
      properties: {
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Danh sách metrics: revenue, orders, employees, inventory, receivables, payables',
        },
      },
    }),
    createQueryTool('erp_search', 'Tìm kiếm toàn hệ thống', {
      type: 'object',
      properties: {
        query: { type: 'string' },
        modules: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
    }),
  ],

  contextBuilder: async (context) => {
    const { contextString } = await buildERPContext(context);
    return `Module: Tổng quan ERP\n${contextString}`;
  },
};

// ==================== Helper ====================

function createQueryTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>
): CopilotTool {
  return {
    name,
    description,
    inputSchema,
    execute: async (input, context) => {
      // Placeholder — each module would implement actual data queries
      return JSON.stringify({
        tool: name,
        input,
        tenantId: context.tenantId,
        message: `[Tool ${name}] Query executed. In production, this connects to the module's API.`,
      });
    },
  };
}

// ==================== All Assistants ====================

export const ALL_ASSISTANTS: ModuleAssistant[] = [
  hrmAssistant,
  accountingAssistant,
  mrpAssistant,
  crmAssistant,
  generalAssistant,
];
