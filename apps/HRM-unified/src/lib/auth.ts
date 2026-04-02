import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db } from "./db";
import { authConfig } from "./auth.config";
import type { UserRole } from ".prisma/hrm-unified-client";

/**
 * Full auth configuration with Credentials provider
 * This file uses bcryptjs and Prisma - NOT Edge Runtime compatible
 * Used by API routes and server components
 */

// Extended user type for our app
interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  employeeId?: string;
  uaHash?: string; // User agent fingerprint hash
}

/** Create a short hash of the user agent for session fingerprinting */
function hashUserAgent(ua: string): string {
  return crypto.createHash("sha256").update(ua).digest("hex").slice(0, 16);
}

declare module "next-auth" {
  interface Session {
    user: AppUser;
  }
  interface User extends AppUser {}
}

// JWT type extended inline in callbacks
interface ExtendedJWT {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName: string;
  employeeId?: string;
  uaHash?: string; // User agent fingerprint hash for session binding
}

// =============================================================================
// SSO PROVIDER (conditional)
// =============================================================================

function getSSOProvider() {
  if (process.env.ENABLE_SUPABASE_SSO !== "true") return [];
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return [];

  const { createSupabaseSSOProvider } = require("@prismy/sso");

  return [
    createSupabaseSSOProvider({
      appId: "hrm" as const,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      findLocalUser: async ({ id }: { id: string }) => {
        const user = await db.user.findUnique({
          where: { id },
          include: { tenant: true },
        });
        return user ? { id: user.id, tenantId: user.tenantId } : null;
      },
      createLocalUser: async ({
        email,
        name,
        role,
        organizationId,
      }: {
        email: string;
        name: string;
        role: string;
        organizationId: string;
      }) => {
        // Find or create tenant mapped to this Supabase organization
        let tenant = await db.tenant.findFirst({
          where: { code: `sso-${organizationId}` },
        });
        if (!tenant) {
          tenant = await db.tenant.create({
            data: {
              name: `SSO Organization`,
              code: `sso-${organizationId}`,
              isActive: true,
            },
          });
        }

        const bcryptLib = await import("bcryptjs");
        const user = await db.user.create({
          data: {
            email,
            name,
            passwordHash: await bcryptLib.default.hash(crypto.randomUUID(), 10),
            role: (role as UserRole) || "VIEWER",
            tenantId: tenant.id,
            isActive: true,
          },
        });
        return { id: user.id, tenantId: tenant.id };
      },
    }),
  ];
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email và mật khẩu là bắt buộc");
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        const user = await db.user.findFirst({
          where: {
            email: email,
            isActive: true,
          },
          include: {
            tenant: true,
          },
        });

        if (!user) {
          throw new Error("Email hoặc mật khẩu không chính xác");
        }

        if (!user.tenant.isActive) {
          throw new Error("Tài khoản công ty đã bị vô hiệu hóa");
        }

        const isPasswordValid = await bcrypt.compare(
          password,
          user.passwordHash,
        );

        if (!isPasswordValid) {
          throw new Error("Email hoặc mật khẩu không chính xác");
        }

        // Update last login
        await db.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Capture user agent fingerprint for session binding
        const userAgent = request?.headers?.get?.("user-agent") || "";
        const uaHash = userAgent ? hashUserAgent(userAgent) : undefined;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          tenantName: user.tenant.name,
          employeeId: user.employeeId || undefined,
          uaHash,
        };
      },
    }),
    ...getSSOProvider(),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        const extToken = token as unknown as ExtendedJWT;
        extToken.id = user.id!;
        extToken.email = user.email!;
        extToken.name = user.name!;
        extToken.role = user.role!;
        extToken.employeeId = user.employeeId;
        extToken.uaHash = user.uaHash;

        // SSO users have tenantId from provider but may not have tenantName
        if (user.tenantId) {
          extToken.tenantId = user.tenantId;
          if (user.tenantName) {
            extToken.tenantName = user.tenantName;
          } else {
            // Fetch tenant name for SSO users
            const tenant = await db.tenant.findUnique({
              where: { id: user.tenantId },
            });
            extToken.tenantName = tenant?.name || "SSO Organization";
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      const extToken = token as unknown as ExtendedJWT;
      // @ts-expect-error - NextAuth type issue with custom session user
      session.user = {
        id: extToken.id,
        email: extToken.email,
        name: extToken.name,
        role: extToken.role,
        tenantId: extToken.tenantId,
        tenantName: extToken.tenantName,
        employeeId: extToken.employeeId,
      };
      // Store fingerprint hash on session for middleware validation
      // @ts-expect-error - custom session property
      session.uaHash = extToken.uaHash;
      return session;
    },
  },
});
