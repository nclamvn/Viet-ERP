// ============================================================
// Prisma 7+ Configuration File
// Replaces url in datasource block (breaking change in v7)
// ============================================================

import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load .env from multiple locations (monorepo friendly)
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  earlyAccess: true,
  schema: path.resolve(__dirname, 'prisma/schema.prisma'),
  migrate: {
    schema: path.resolve(__dirname, 'prisma/schema.prisma'),
  },
});
