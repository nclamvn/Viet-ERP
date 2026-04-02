import type { NextAuthConfig } from "next-auth";
import type { UserRole } from ".prisma/hrm-client";

const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/employees": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
  ],
  "/kpi": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER", "EMPLOYEE"],
  "/payroll": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "ACCOUNTANT"],
  "/recruitment": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER"],
  "/hr-events": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  "/offboarding": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF", "DEPT_MANAGER"],
  "/reports": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
  ],
  "/approvals": ["SUPER_ADMIN", "HR_MANAGER", "DEPT_MANAGER"],
  "/advances": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
  "/attendance": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
  "/copilot": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
  "/profile": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
  "/reviews": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
  "/reports-hub": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  "/templates": ["SUPER_ADMIN", "HR_MANAGER", "HR_STAFF"],
  "/import": ["SUPER_ADMIN"],
  "/admin": ["SUPER_ADMIN"],
  "/portal": [
    "SUPER_ADMIN",
    "HR_MANAGER",
    "HR_STAFF",
    "DEPT_MANAGER",
    "EMPLOYEE",
    "ACCOUNTANT",
  ],
};

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: UserRole }).role;
        token.userId = user.id as string;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.role = token.role as UserRole;
        session.user.id = token.userId as string;
      }
      return session;
    },
    async authorized({ auth: session, request }) {
      const isLoggedIn = !!session?.user;
      const { pathname } = request.nextUrl;
      const isOnLogin = pathname.startsWith("/login");

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/", request.nextUrl));
        return true;
      }

      if (!isLoggedIn) return false;

      // RBAC route check — match longest prefix first, break on first match
      const userRole = session?.user?.role as UserRole | undefined;
      if (userRole) {
        const matchedRoute = Object.keys(ROUTE_PERMISSIONS)
          .filter((route) => pathname.startsWith(route))
          .sort((a, b) => b.length - a.length)[0];

        if (
          matchedRoute &&
          !ROUTE_PERMISSIONS[matchedRoute].includes(userRole)
        ) {
          return Response.redirect(new URL("/unauthorized", request.nextUrl));
        }
      }

      return true;
    },
  },
  providers: [],
};
