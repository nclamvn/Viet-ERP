// ============================================================
// @vierp/sdk — OpenAPI Specification Generator
// Generates OpenAPI 3.1 specs for all ERP modules
// ============================================================

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes: Record<string, unknown>;
  };
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string; description: string }>;
}

/**
 * Generate OpenAPI 3.1 specification for the entire ERP API
 */
export function generateERPOpenAPISpec(baseUrl: string = 'https://erp.example.com/api'): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ERP Ecosystem API',
      version: '1.0.0',
      description: 'Vietnamese Manufacturing ERP — Full REST API covering HRM, CRM, MRP, Accounting, PM, OTB, TPM, ExcelAI modules. VAS/IFRS compliant.',
    },
    servers: [
      { url: baseUrl, description: 'Production' },
      { url: 'http://localhost:8000/api', description: 'Development (via Kong Gateway)' },
    ],
    paths: {
      // Master Data
      '/master/customers': generateCRUDPaths('Customer', 'Khách hàng'),
      '/master/products': generateCRUDPaths('Product', 'Sản phẩm'),
      '/master/employees': generateCRUDPaths('Employee', 'Nhân viên'),
      '/master/suppliers': generateCRUDPaths('Supplier', 'Nhà cung cấp'),
      // HRM
      '/hrm/attendance': generateCRUDPaths('Attendance', 'Chấm công'),
      '/hrm/leave': generateCRUDPaths('LeaveRequest', 'Nghỉ phép'),
      '/hrm/payroll': generateCRUDPaths('Payroll', 'Bảng lương'),
      // Accounting
      '/acc/gl/accounts': generateCRUDPaths('Account', 'Tài khoản kế toán'),
      '/acc/gl/journals': generateCRUDPaths('JournalEntry', 'Bút toán'),
      '/acc/ap/invoices': generateCRUDPaths('APInvoice', 'Hóa đơn mua hàng'),
      '/acc/ar/invoices': generateCRUDPaths('ARInvoice', 'Hóa đơn bán hàng'),
      '/acc/einvoice': generateCRUDPaths('EInvoice', 'Hóa đơn điện tử'),
      '/acc/tax/declarations': generateCRUDPaths('TaxDeclaration', 'Tờ khai thuế'),
      '/acc/reports/balance-sheet': { get: { tags: ['Accounting Reports'], summary: 'Get Balance Sheet (B01-DN)', parameters: [{ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }] } },
      '/acc/reports/income-statement': { get: { tags: ['Accounting Reports'], summary: 'Get Income Statement (B02-DN)', parameters: [{ name: 'periodStart', in: 'query', schema: { type: 'string' } }, { name: 'periodEnd', in: 'query', schema: { type: 'string' } }] } },
      // MRP
      '/mrp/production/work-orders': generateCRUDPaths('WorkOrder', 'Lệnh sản xuất'),
      '/mrp/inventory': generateCRUDPaths('Inventory', 'Tồn kho'),
      '/mrp/bom': generateCRUDPaths('BOM', 'Định mức nguyên vật liệu'),
      // CRM
      '/crm/deals': generateCRUDPaths('Deal', 'Cơ hội kinh doanh'),
      '/crm/quotes': generateCRUDPaths('Quote', 'Báo giá'),
      '/crm/orders': generateCRUDPaths('SalesOrder', 'Đơn hàng'),
      // PM
      '/pm/projects': generateCRUDPaths('Project', 'Dự án'),
      '/pm/tasks': generateCRUDPaths('Task', 'Công việc'),
      '/pm/sprints': generateCRUDPaths('Sprint', 'Sprint'),
      // Webhooks
      '/webhooks': generateCRUDPaths('Webhook', 'Webhook'),
      '/webhooks/deliveries': { get: { tags: ['Webhooks'], summary: 'List webhook deliveries' } },
    },
    components: {
      schemas: {
        ApiResponse: { type: 'object', properties: { success: { type: 'boolean' }, data: {}, error: { $ref: '#/components/schemas/ApiError' }, meta: { $ref: '#/components/schemas/PaginationMeta' } } },
        ApiError: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } },
        PaginationMeta: { type: 'object', properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
        Customer: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, taxCode: { type: 'string' }, type: { type: 'string', enum: ['individual', 'company'] }, status: { type: 'string' } } },
        Product: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, unit: { type: 'string' }, price: { type: 'number' }, cost: { type: 'number' }, category: { type: 'string' } } },
        Employee: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, department: { type: 'string' }, position: { type: 'string' }, hireDate: { type: 'string', format: 'date' } } },
        JournalEntry: { type: 'object', properties: { id: { type: 'string' }, entryNumber: { type: 'string' }, entryDate: { type: 'string', format: 'date' }, journalType: { type: 'string' }, description: { type: 'string' }, totalDebit: { type: 'number' }, totalCredit: { type: 'number' }, status: { type: 'string' } } },
      },
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    tags: [
      { name: 'Master Data', description: 'Shared master data: customers, products, employees, suppliers' },
      { name: 'HRM', description: 'Human Resource Management: attendance, leave, payroll' },
      { name: 'Accounting', description: 'Accounting & Finance: GL, AP, AR, e-Invoice, tax' },
      { name: 'Accounting Reports', description: 'Financial reports: B01-DN, B02-DN, B03-DN' },
      { name: 'MRP', description: 'Manufacturing: production, inventory, BOM' },
      { name: 'CRM', description: 'Customer Relationship: deals, quotes, orders' },
      { name: 'PM', description: 'Project Management: projects, tasks, sprints' },
      { name: 'Webhooks', description: 'Webhook management and delivery logs' },
    ],
  };
}

function generateCRUDPaths(schemaName: string, description: string): Record<string, unknown> {
  return {
    get: {
      tags: [getTagForSchema(schemaName)],
      summary: `List ${description}`,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'sortBy', in: 'query', schema: { type: 'string' } },
        { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ],
      responses: { '200': { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } } } },
    },
    post: {
      tags: [getTagForSchema(schemaName)],
      summary: `Create ${description}`,
      requestBody: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } } },
      responses: { '201': { description: 'Created' }, '400': { description: 'Validation error' }, '409': { description: 'Duplicate' } },
    },
    put: {
      tags: [getTagForSchema(schemaName)],
      summary: `Update ${description}`,
      parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
    },
    delete: {
      tags: [getTagForSchema(schemaName)],
      summary: `Delete ${description}`,
      parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
    },
  };
}

function getTagForSchema(name: string): string {
  const map: Record<string, string> = {
    Customer: 'Master Data', Product: 'Master Data', Employee: 'Master Data', Supplier: 'Master Data',
    Attendance: 'HRM', LeaveRequest: 'HRM', Payroll: 'HRM',
    Account: 'Accounting', JournalEntry: 'Accounting', APInvoice: 'Accounting', ARInvoice: 'Accounting',
    EInvoice: 'Accounting', TaxDeclaration: 'Accounting',
    WorkOrder: 'MRP', Inventory: 'MRP', BOM: 'MRP',
    Deal: 'CRM', Quote: 'CRM', SalesOrder: 'CRM',
    Project: 'PM', Task: 'PM', Sprint: 'PM',
    Webhook: 'Webhooks',
  };
  return map[name] || 'General';
}
