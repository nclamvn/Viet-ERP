// ============================================================
// ERP Documentation Content & Developer Portal
// Auto-generated from OpenAPI spec + manual guides
// ============================================================

// ─── Types ───────────────────────────────────────────────────

export interface DocSection {
  id: string;
  title: string;
  titleVi: string;
  slug: string;
  category: DocCategory;
  content: string;
  order: number;
  tags: string[];
}

export type DocCategory =
  | 'getting-started'
  | 'guides'
  | 'api-reference'
  | 'modules'
  | 'sdk'
  | 'deployment'
  | 'security'
  | 'changelog';

// ─── Documentation Structure ─────────────────────────────────

export const DOCUMENTATION: DocSection[] = [
  // ── Getting Started ──────────────────────────────────────
  {
    id: 'intro',
    title: 'Introduction',
    titleVi: 'Giới thiệu',
    slug: 'introduction',
    category: 'getting-started',
    order: 1,
    tags: ['overview', 'start'],
    content: `
# ERP Ecosystem

A comprehensive, modular ERP platform designed for Vietnamese businesses.
Built with Next.js 14, TypeScript, PostgreSQL, and NATS event streaming.

## Architecture Overview

\`\`\`
┌─────────────────────────────────────────────────────────┐
│                    Kong API Gateway                      │
│              (Rate Limiting, Auth, Routing)               │
├───────┬───────┬───────┬───────┬───────┬───────┬─────────┤
│  HRM  │  CRM  │  MRP  │ Acctg │  PM   │E-comm │  ...    │
│ :3001 │ :3002 │ :3003 │ :3007 │ :3005 │ :3008 │         │
├───────┴───────┴───────┴───────┴───────┴───────┴─────────┤
│           Shared Packages (TypeScript Monorepo)          │
│  shared │ database │ auth │ events │ cache │ security    │
├─────────────────────────────────────────────────────────┤
│  PostgreSQL 16  │  NATS JetStream  │  Redis  │ Keycloak │
└─────────────────────────────────────────────────────────┘
\`\`\`

## Tiers

| Feature | Basic (990K₫/mo) | Pro (2.99M₫/mo) | Enterprise (7.99M₫/mo) |
|---------|:-:|:-:|:-:|
| HRM, CRM, PM, Excel AI | ✅ | ✅ | ✅ |
| Accounting (VAS) | – | ✅ | ✅ |
| MRP, OTB, TPM | – | ✅ | ✅ |
| E-commerce | – | – | ✅ |
| AI Copilot | – | – | ✅ |
| Developer SDK | – | – | ✅ |
| IFRS Reporting | – | – | ✅ |
| Max Users | 10 | 50 | Unlimited |
| SLA | 99.5% | 99.9% | 99.95% |

## Quick Start

\`\`\`bash
# Clone and install
git clone https://github.com/erp-ecosystem/erp.git
cd erp && npm install

# Start infrastructure
docker compose up -d

# Run all modules in dev mode
npx turbo dev
\`\`\`
`,
  },

  {
    id: 'authentication',
    title: 'Authentication',
    titleVi: 'Xác thực',
    slug: 'authentication',
    category: 'getting-started',
    order: 2,
    tags: ['auth', 'keycloak', 'jwt', 'api-key'],
    content: `
# Authentication

ERP supports two authentication methods:

## 1. JWT Bearer Token (User sessions)

\`\`\`typescript
// Login via Keycloak
const response = await fetch('https://api.erp.vn/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@company.vn',
    password: 'your-password',
  }),
});

const { accessToken, refreshToken } = await response.json();

// Use token in subsequent requests
const data = await fetch('https://api.erp.vn/api/v1/hrm/employees', {
  headers: { 'Authorization': \`Bearer \${accessToken}\` },
});
\`\`\`

## 2. API Key (SDK / Integrations)

\`\`\`typescript
import { ERPClient } from '@vierp/sdk';

const client = new ERPClient({
  baseUrl: 'https://api.erp.vn',
  apiKey: 'erp_live_xxxxxxxxxxxxxxxxxxxxxxxx',
  tenantId: 'your-tenant-id',
});

const customers = await client.customers.list({ page: 1, limit: 20 });
\`\`\`

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Authentication | 10 req / 15 min |
| API (per tenant) | 100 req / min |
| Webhooks | 30 req / min |
| AI Copilot | 10 req / min |
`,
  },

  // ── Module Guides ────────────────────────────────────────
  {
    id: 'module-accounting',
    title: 'Accounting Module',
    titleVi: 'Module Kế toán',
    slug: 'accounting',
    category: 'modules',
    order: 10,
    tags: ['accounting', 'vas', 'journal', 'tax', 'einvoice'],
    content: `
# Accounting Module (Kế toán)

Full Vietnamese Accounting Standards (VAS) compliance per Thông tư 200/2014/TT-BTC.

## Features

- **Chart of Accounts**: 136 accounts per TT200 (Loại 1–9)
- **General Ledger**: Journal entries with debit=credit validation
- **Accounts Payable/Receivable**: AP/AR with aging analysis
- **E-Invoice**: Per Nghị định 123/2020 + Thông tư 78/2021
- **E-Tax**: HTKK-compatible XML for VAT, CIT, PIT declarations
- **Financial Reports**: B01-DN (Balance Sheet), B02-DN (Income Statement), B03-DN (Cash Flow)
- **IFRS**: Parallel reporting with 31 VAS→IFRS mapping rules

## Journal Entry API

\`\`\`typescript
// Create a sales journal entry
const entry = await client.module('accounting').post('/journals', {
  type: 'HD', // Hóa đơn
  date: '2026-03-27',
  description: 'Bán hàng cho KH ABC',
  lines: [
    { accountCode: '131',   debit: 11000000, credit: 0,        description: 'Phải thu' },
    { accountCode: '5111',  debit: 0,        credit: 10000000, description: 'Doanh thu' },
    { accountCode: '33311', debit: 0,        credit: 1000000,  description: 'VAT 10%' },
  ],
});
\`\`\`

## Tax Engine

\`\`\`typescript
// Calculate PIT for an employee
import { calculatePIT } from '@vierp/accounting/lib/tax-engine';

const result = calculatePIT({
  grossSalary: 30000000,
  socialInsurance: 2400000,
  personalDeduction: 11000000,
  dependentDeduction: 4400000, // 1 dependent
});
// result.netSalary = 25,460,000 VND
\`\`\`
`,
  },

  {
    id: 'module-ecommerce',
    title: 'E-commerce Module',
    titleVi: 'Module Thương mại điện tử',
    slug: 'ecommerce',
    category: 'modules',
    order: 11,
    tags: ['ecommerce', 'orders', 'payments', 'shipping'],
    content: `
# E-commerce Module

B2B + B2C multi-storefront platform optimized for Vietnamese market.

## Payment Gateways

| Gateway | Method | Status |
|---------|--------|--------|
| VNPay | ATM, Visa/MC, QR | ✅ |
| MoMo | E-wallet | ✅ |
| ZaloPay | E-wallet | ✅ |
| Bank Transfer | VietQR | ✅ |
| COD | Cash | ✅ |

## Shipping Providers

GHN, GHTK, Viettel Post, J&T Express, Ninja Van, GrabExpress

## Order Flow

\`\`\`
PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED → COMPLETED
                                                    ↓
                                              RETURNED → REFUNDED
\`\`\`

## Accounting Integration

Orders automatically generate VAS journal entries:
- Revenue: Debit 131 / Credit 5111 + 33311
- COGS: Debit 632 / Credit 156
- Refund: Debit 5212 / Credit 131
`,
  },

  // ── SDK Guide ────────────────────────────────────────────
  {
    id: 'sdk-overview',
    title: 'Developer SDK',
    titleVi: 'SDK nhà phát triển',
    slug: 'sdk',
    category: 'sdk',
    order: 20,
    tags: ['sdk', 'api', 'webhooks', 'plugins'],
    content: `
# Developer SDK

Type-safe TypeScript SDK for integrating with the ERP API.

## Installation

\`\`\`bash
npm install @vierp/sdk
\`\`\`

## Client Setup

\`\`\`typescript
import { ERPClient } from '@vierp/sdk';

const client = new ERPClient({
  baseUrl: 'https://api.erp.vn',
  apiKey: process.env.ERP_API_KEY!,
  tenantId: process.env.ERP_TENANT_ID!,
  timeout: 30000,
  retries: 3,
});

// Master Data CRUD
const customers = await client.customers.list({ page: 1, limit: 20 });
const customer = await client.customers.get('cust-id');
await client.customers.create({ name: 'Công ty ABC', taxCode: '0123456789' });

// Module-specific operations
const journals = await client.module('accounting').get('/journals', { period: '2026-03' });
const orders = await client.module('ecommerce').get('/orders', { status: 'PENDING' });
\`\`\`

## Webhooks

\`\`\`typescript
import { WebhookManager } from '@vierp/sdk';

const webhooks = new WebhookManager(client);

// Register webhook
await webhooks.register({
  url: 'https://your-app.com/webhooks/erp',
  events: ['order.created', 'invoice.paid', 'customer.*'],
  secret: 'your-webhook-secret',
});

// Verify incoming webhook
const isValid = WebhookManager.verifySignature(
  payload,
  signature, // X-Webhook-Signature header
  'your-webhook-secret'
);
\`\`\`

## Plugins

\`\`\`typescript
import { PluginManager } from '@vierp/sdk';

const plugins = new PluginManager();

plugins.install({
  id: 'custom-report',
  name: 'Custom Financial Report',
  version: '1.0.0',
  hooks: {
    'accounting.period.close': async (ctx, data) => {
      // Generate custom report after period close
      await generateCustomReport(data.periodId);
    },
  },
  routes: [
    {
      method: 'GET',
      path: '/custom-reports/:id',
      handler: async (ctx, req) => {
        return { data: await fetchReport(req.params.id) };
      },
    },
  ],
});
\`\`\`
`,
  },

  // ── Deployment Guide ─────────────────────────────────────
  {
    id: 'deployment',
    title: 'Deployment Guide',
    titleVi: 'Hướng dẫn triển khai',
    slug: 'deployment',
    category: 'deployment',
    order: 30,
    tags: ['docker', 'kubernetes', 'ci-cd', 'production'],
    content: `
# Deployment Guide

## Docker

\`\`\`bash
# Build a specific service
docker build -f infrastructure/docker/Dockerfile \\
  --build-arg APP_NAME=Accounting \\
  -t erp/accounting:latest .

# Run full stack
cd infrastructure/docker
docker compose -f docker-compose.production.yml up -d
\`\`\`

## Kubernetes

\`\`\`bash
# Apply base resources
kubectl apply -f infrastructure/k8s/base/namespace.yml
kubectl apply -f infrastructure/k8s/base/

# Use Kustomize for environment overlays
kubectl apply -k infrastructure/k8s/overlays/staging/
kubectl apply -k infrastructure/k8s/overlays/production/
\`\`\`

## CI/CD

GitHub Actions workflows:
- **ci.yml**: Lint → Typecheck → Test → Build (on PR)
- **deploy.yml**: Test → Build Docker → Push Registry → Deploy K8s (on merge to main)

Auto-detection of changed services — only builds/deploys what changed.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | PostgreSQL connection string | ✅ |
| NATS_URL | NATS server URL | ✅ |
| REDIS_URL | Redis connection URL | ✅ |
| KEYCLOAK_URL | Keycloak base URL | ✅ |
| ANTHROPIC_API_KEY | For AI Copilot | Enterprise |
`,
  },

  // ── Security Guide ───────────────────────────────────────
  {
    id: 'security',
    title: 'Security Guide',
    titleVi: 'Bảo mật',
    slug: 'security',
    category: 'security',
    order: 40,
    tags: ['security', 'rbac', 'encryption', 'audit'],
    content: `
# Security

## Role-Based Access Control (RBAC)

11 built-in roles with granular permissions:

| Role | Modules | Key Permissions |
|------|---------|-----------------|
| super_admin | All | Full access |
| admin | All | Manage users, settings |
| accountant | Accounting | Journal approve, period close, tax |
| hr_manager | HRM | Payroll, leave approval |
| sales_manager | CRM, E-commerce | Pipeline, orders, promotions |
| warehouse_manager | MRP, E-commerce | Inventory, production |
| project_manager | PM | Assign tasks, manage projects |
| ecommerce_manager | E-commerce, CRM | Orders, refunds, promotions |
| employee | HRM, PM, CRM | Read-only basics |
| viewer | All | Read-only |
| api_client | Master Data, CRM, E-commerce | SDK integration |

## Security Features

- **Authentication**: Keycloak SSO with JWT tokens
- **API Keys**: HMAC-SHA256 signed, prefix-based identification
- **Rate Limiting**: Per-tenant, per-endpoint sliding window
- **Input Sanitization**: XSS prevention, SQL injection defense
- **CSRF Protection**: Token-based with timing-safe comparison
- **Security Headers**: CSP, HSTS, X-Frame-Options
- **Audit Trail**: All sensitive operations logged with before/after diffs
- **IP Filtering**: Whitelist/blacklist with CIDR support
`,
  },
];

// ─── Documentation Search ────────────────────────────────────

/**
 * Full-text search across documentation
 */
export function searchDocs(
  query: string,
  options: { category?: DocCategory; limit?: number } = {}
): DocSection[] {
  const { category, limit = 10 } = options;
  const terms = query.toLowerCase().split(/\s+/);

  let results = DOCUMENTATION;

  if (category) {
    results = results.filter(doc => doc.category === category);
  }

  // Score-based search
  const scored = results.map(doc => {
    const searchText = `${doc.title} ${doc.titleVi} ${doc.content} ${doc.tags.join(' ')}`.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (doc.title.toLowerCase().includes(term)) score += 10;
      if (doc.titleVi.toLowerCase().includes(term)) score += 10;
      if (doc.tags.some(t => t.includes(term))) score += 5;
      if (searchText.includes(term)) score += 1;
    }

    return { doc, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.doc);
}

/**
 * Get table of contents
 */
export function getTableOfContents(): Array<{
  category: DocCategory;
  categoryLabel: string;
  sections: Array<{ id: string; title: string; slug: string }>;
}> {
  const categories: Array<{ key: DocCategory; label: string }> = [
    { key: 'getting-started', label: 'Getting Started' },
    { key: 'modules', label: 'Modules' },
    { key: 'sdk', label: 'Developer SDK' },
    { key: 'api-reference', label: 'API Reference' },
    { key: 'deployment', label: 'Deployment' },
    { key: 'security', label: 'Security' },
    { key: 'changelog', label: 'Changelog' },
  ];

  return categories.map(cat => ({
    category: cat.key,
    categoryLabel: cat.label,
    sections: DOCUMENTATION
      .filter(doc => doc.category === cat.key)
      .sort((a, b) => a.order - b.order)
      .map(doc => ({ id: doc.id, title: doc.title, slug: doc.slug })),
  })).filter(cat => cat.sections.length > 0);
}
