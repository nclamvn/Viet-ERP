// src/lib/optimization/bundle-config.ts

/**
 * LAC VIET HR - Bundle Optimization Configuration
 * Webpack and Next.js optimization settings
 */

import type { NextConfig } from "next";

// ════════════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════════════

export interface BundleAnalysis {
  totalSize: number;
  chunks: ChunkInfo[];
  assets: AssetInfo[];
  warnings: string[];
}

export interface ChunkInfo {
  name: string;
  size: number;
  modules: number;
  isEntry: boolean;
  isAsync: boolean;
}

export interface AssetInfo {
  name: string;
  size: number;
  type: "js" | "css" | "image" | "font" | "other";
  chunks: string[];
}

export interface SizeLimit {
  name: string;
  path: string;
  limit: string;
}

// ════════════════════════════════════════════════════════════════════════════════
// SIZE BUDGETS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Bundle size budgets for performance monitoring
 */
export const SizeBudgets: SizeLimit[] = [
  // Core bundles
  { name: "Main JS", path: ".next/static/chunks/main-*.js", limit: "150kb" },
  {
    name: "Framework JS",
    path: ".next/static/chunks/framework-*.js",
    limit: "150kb",
  },
  {
    name: "Commons JS",
    path: ".next/static/chunks/commons-*.js",
    limit: "100kb",
  },

  // Page bundles
  {
    name: "App Shell",
    path: ".next/static/chunks/pages/_app-*.js",
    limit: "50kb",
  },
  {
    name: "Dashboard Page",
    path: ".next/static/chunks/pages/dashboard-*.js",
    limit: "100kb",
  },
  {
    name: "Employee Page",
    path: ".next/static/chunks/pages/employees-*.js",
    limit: "80kb",
  },

  // CSS
  { name: "Global CSS", path: ".next/static/css/*.css", limit: "100kb" },

  // Total
  { name: "Total Initial JS", path: ".next/static/**/*.js", limit: "500kb" },
];

// ════════════════════════════════════════════════════════════════════════════════
// EXTERNAL PACKAGES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Packages that should not be bundled (use CDN or server-only)
 */
export const ExternalPackages = [
  // Heavy packages that should be loaded from CDN in production
  "lodash",
  "moment",
  "chart.js",

  // Server-only packages
  "bcrypt",
  "sharp",
  ".prisma/hrm-ai-client",
];

/**
 * Packages that should be transpiled
 */
export const TranspilePackages = [
  "@radix-ui",
  "lucide-react",
  "@tanstack/react-query",
  "@tanstack/react-table",
];

// ════════════════════════════════════════════════════════════════════════════════
// CODE SPLITTING CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Chunk groups for code splitting
 */
export const ChunkGroups = {
  // Vendor chunks
  react: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
  ui: /[\\/]node_modules[\\/](@radix-ui|@headlessui|lucide-react)[\\/]/,
  forms: /[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
  table: /[\\/]node_modules[\\/](@tanstack[\\/]react-table)[\\/]/,
  query: /[\\/]node_modules[\\/](@tanstack[\\/]react-query)[\\/]/,
  charts: /[\\/]node_modules[\\/](recharts|chart\.js|d3)[\\/]/,
  dates: /[\\/]node_modules[\\/](date-fns|dayjs)[\\/]/,
  pdf: /[\\/]node_modules[\\/](@react-pdf|pdfmake)[\\/]/,
  excel: /[\\/]node_modules[\\/](xlsx|exceljs)[\\/]/,

  // Feature chunks
  auth: /[\\/]src[\\/](lib|components)[\\/]auth[\\/]/,
  dashboard: /[\\/]src[\\/](app|components)[\\/]dashboard[\\/]/,
  employees: /[\\/]src[\\/](app|components)[\\/]employees[\\/]/,
  attendance: /[\\/]src[\\/](app|components)[\\/]attendance[\\/]/,
  payroll: /[\\/]src[\\/](app|components)[\\/]payroll[\\/]/,
  leave: /[\\/]src[\\/](app|components)[\\/]leave[\\/]/,
  recruitment: /[\\/]src[\\/](app|components)[\\/]recruitment[\\/]/,
  reports: /[\\/]src[\\/](app|components)[\\/]reports[\\/]/,
  settings: /[\\/]src[\\/](app|components)[\\/]settings[\\/]/,
};

// ════════════════════════════════════════════════════════════════════════════════
// WEBPACK CONFIGURATION HELPER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate webpack split chunks configuration
 */
export function generateSplitChunksConfig() {
  return {
    chunks: "all" as const,
    maxInitialRequests: 25,
    minSize: 20000,
    maxSize: 244000,
    cacheGroups: {
      // Framework
      framework: {
        name: "framework",
        test: ChunkGroups.react,
        priority: 50,
        enforce: true,
        reuseExistingChunk: true,
      },

      // UI Components
      ui: {
        name: "ui",
        test: ChunkGroups.ui,
        priority: 40,
        reuseExistingChunk: true,
      },

      // Form handling
      forms: {
        name: "forms",
        test: ChunkGroups.forms,
        priority: 35,
        reuseExistingChunk: true,
      },

      // Table handling
      table: {
        name: "table",
        test: ChunkGroups.table,
        priority: 30,
        reuseExistingChunk: true,
      },

      // Data fetching
      query: {
        name: "query",
        test: ChunkGroups.query,
        priority: 30,
        reuseExistingChunk: true,
      },

      // Charts - lazy loaded
      charts: {
        name: "charts",
        test: ChunkGroups.charts,
        priority: 20,
        reuseExistingChunk: true,
      },

      // Date utilities
      dates: {
        name: "dates",
        test: ChunkGroups.dates,
        priority: 20,
        reuseExistingChunk: true,
      },

      // PDF generation - lazy loaded
      pdf: {
        name: "pdf",
        test: ChunkGroups.pdf,
        priority: 10,
        reuseExistingChunk: true,
      },

      // Excel handling - lazy loaded
      excel: {
        name: "excel",
        test: ChunkGroups.excel,
        priority: 10,
        reuseExistingChunk: true,
      },

      // Default vendor chunk
      vendors: {
        name: "vendors",
        test: /[\\/]node_modules[\\/]/,
        priority: 5,
        reuseExistingChunk: true,
      },

      // Common shared code
      common: {
        name: "common",
        minChunks: 2,
        priority: 1,
        reuseExistingChunk: true,
      },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// NEXT.JS CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Generate optimized Next.js configuration
 */
export function generateNextConfig(baseConfig: NextConfig = {}): NextConfig {
  return {
    ...baseConfig,

    // Enable strict mode
    reactStrictMode: true,

    // Enable SWC minifier
    swcMinify: true,

    // Standalone output for Docker
    output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,

    // Compiler options
    compiler: {
      // Remove console in production
      removeConsole:
        process.env.NODE_ENV === "production"
          ? {
              exclude: ["error", "warn"],
            }
          : false,
    },

    // Experimental features
    experimental: {
      // Optimize package imports
      optimizePackageImports: [
        "@radix-ui/react-icons",
        "lucide-react",
        "date-fns",
        "@tanstack/react-table",
      ],
    },

    // Image optimization
    images: {
      formats: ["image/avif", "image/webp"],
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
      imageSizes: [16, 32, 48, 64, 96, 128, 256],
      minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
      dangerouslyAllowSVG: true,
      contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    },

    // Headers for caching
    async headers() {
      return [
        {
          source: "/static/:path*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
        {
          source: "/_next/static/:path*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
        {
          source: "/fonts/:path*",
          headers: [
            {
              key: "Cache-Control",
              value: "public, max-age=31536000, immutable",
            },
          ],
        },
      ];
    },

    // Webpack configuration
    webpack: (config, { isServer, dev }) => {
      // Only apply optimizations in production client builds
      if (!isServer && !dev) {
        config.optimization = {
          ...config.optimization,
          splitChunks: generateSplitChunksConfig(),
          runtimeChunk: {
            name: "runtime",
          },
        };
      }

      // Aliases for common imports
      config.resolve = {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          "@": "./src",
        },
      };

      return config;
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// TURBOPACK CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Turbopack-specific configuration (for dev mode)
 */
export const TurbopackConfig = {
  // Rules for different file types
  rules: {
    "*.svg": {
      loaders: ["@svgr/webpack"],
      as: "*.js",
    },
  },

  // Resolve aliases
  resolveAlias: {
    "@": "./src",
    "@/components": "./src/components",
    "@/lib": "./src/lib",
    "@/hooks": "./src/hooks",
    "@/styles": "./src/styles",
    "@/types": "./src/types",
  },
};

// ════════════════════════════════════════════════════════════════════════════════
// TREE SHAKING HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Mark packages as side-effect free for better tree shaking
 */
export const SideEffectFreePackages = [
  "lodash-es",
  "date-fns",
  "@radix-ui/*",
  "lucide-react",
];

/**
 * Modules that should be marked as external in SSR
 */
export const SSRExternals = [
  "bcrypt",
  "sharp",
  ".prisma/hrm-ai-client",
  "puppeteer",
];

// ════════════════════════════════════════════════════════════════════════════════
// BUNDLE ANALYZER HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Parse bundle size string to bytes
 */
export function parseSizeToBytes(size: string): number {
  const match = size.match(/^([\d.]+)\s*(b|kb|mb|gb)?$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "b").toLowerCase();

  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  return Math.round(value * (multipliers[unit] || 1));
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Check if bundle exceeds size limit
 */
export function checkSizeLimit(
  actualSize: number,
  limit: string,
): { exceeded: boolean; percentage: number } {
  const limitBytes = parseSizeToBytes(limit);
  const percentage = (actualSize / limitBytes) * 100;

  return {
    exceeded: actualSize > limitBytes,
    percentage: Math.round(percentage),
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// DYNAMIC IMPORT HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create named dynamic import with webpack magic comments
 */
export function createDynamicImport(
  modulePath: string,
  chunkName: string,
  prefetch: boolean = false,
): string {
  const comments = [
    `webpackChunkName: "${chunkName}"`,
    prefetch ? "webpackPrefetch: true" : "",
  ]
    .filter(Boolean)
    .join(", ");

  return `import(/* ${comments} */ '${modulePath}')`;
}

/**
 * Prefetch hints for likely next navigations
 */
export const PrefetchHints = {
  // From login page
  login: ["dashboard", "employees"],

  // From dashboard
  dashboard: ["employees", "attendance", "reports"],

  // From employee list
  employees: ["employee-detail", "employee-form"],

  // From attendance
  attendance: ["timesheet", "attendance-report"],

  // From payroll
  payroll: ["payslip", "payroll-report"],
} as const;
