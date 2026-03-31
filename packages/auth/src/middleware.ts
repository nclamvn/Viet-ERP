// ============================================================
// @vierp/auth - Next.js Middleware for Keycloak SSO
// Drop-in replacement for NextAuth middleware
// Usage in any module's middleware.ts:
//   import { withAuth } from '@vierp/auth/middleware';
//   export default withAuth({ requiredRoles: ['admin'] });
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractUser, extractBearerToken } from './token';
import type { KeycloakConfig, AuthMiddlewareOptions, AuthUser, AuthError } from './types';

const DEFAULT_CONFIG: KeycloakConfig = {
  issuerUrl: process.env.SSO_URL
    ? `${process.env.SSO_URL}/realms/${process.env.SSO_REALM || 'erp'}`
    : 'http://localhost:8080/realms/erp',
  clientId: process.env.SSO_CLIENT_ID || 'erp-app',
  clientSecret: process.env.SSO_CLIENT_SECRET,
};

/**
 * Next.js API Route middleware for Keycloak SSO
 * Verifies JWT, extracts user, checks roles/tier, attaches to request headers
 */
export function withAuth(options: AuthMiddlewareOptions = {}) {
  return async function authMiddleware(request: NextRequest): Promise<NextResponse> {
    // Skip auth for public routes
    if (options.isPublic) {
      return NextResponse.next();
    }

    // Skip auth for health check endpoints
    const path = request.nextUrl.pathname;
    if (path === '/api/health' || path === '/api/healthz') {
      return NextResponse.next();
    }

    // Extract token
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token) {
      return authErrorResponse({ code: 'UNAUTHORIZED', message: 'Missing authentication token', status: 401 });
    }

    try {
      // Verify token with Keycloak JWKS
      const payload = await verifyToken(token, DEFAULT_CONFIG);
      const user = extractUser(payload);

      // Check required roles
      if (options.requiredRoles?.length) {
        const hasRole = options.requiredRoles.some(role => user.roles.includes(role));
        if (!hasRole) {
          return authErrorResponse({
            code: 'FORBIDDEN',
            message: `Required roles: ${options.requiredRoles.join(', ')}`,
            status: 403,
          });
        }
      }

      // Check required tier
      if (options.requiredTier) {
        const tierLevel = { basic: 0, pro: 1, enterprise: 2 };
        if (tierLevel[user.tier] < tierLevel[options.requiredTier]) {
          return authErrorResponse({
            code: 'INSUFFICIENT_TIER',
            message: `Required tier: ${options.requiredTier}. Current: ${user.tier}`,
            status: 403,
          });
        }
      }

      // Attach user info to request headers (readable by API routes)
      const response = NextResponse.next();
      response.headers.set('x-user-id', user.id);
      response.headers.set('x-user-email', user.email);
      response.headers.set('x-user-name', user.name);
      response.headers.set('x-user-roles', user.roles.join(','));
      response.headers.set('x-tenant-id', user.tenantId);
      response.headers.set('x-user-tier', user.tier);
      response.headers.set('x-user-permissions', user.permissions.join(','));

      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes('expired')) {
        return authErrorResponse({ code: 'TOKEN_EXPIRED', message: 'Token has expired', status: 401 });
      }
      return authErrorResponse({ code: 'INVALID_TOKEN', message: 'Invalid authentication token', status: 401 });
    }
  };
}

/**
 * Helper to extract authenticated user from request headers
 * Use in API route handlers after middleware has run
 */
export function getAuthUser(request: NextRequest): AuthUser | null {
  const id = request.headers.get('x-user-id');
  if (!id) return null;

  return {
    id,
    email: request.headers.get('x-user-email') || '',
    name: request.headers.get('x-user-name') || '',
    roles: (request.headers.get('x-user-roles') || '').split(',').filter(Boolean),
    tenantId: request.headers.get('x-tenant-id') || 'default',
    tier: (request.headers.get('x-user-tier') as AuthUser['tier']) || 'basic',
    permissions: (request.headers.get('x-user-permissions') || '').split(',').filter(Boolean),
  };
}

/**
 * Route matcher config for Next.js middleware
 * Protects all /api/* routes except health checks and public paths
 */
export const authConfig = {
  matcher: ['/api/((?!health|healthz|public|auth/callback).*)'],
};

function authErrorResponse(error: AuthError): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: error.code, message: error.message } },
    { status: error.status }
  );
}
