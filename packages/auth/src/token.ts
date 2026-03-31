// ============================================================
// @vierp/auth - JWT Token Verification (using jose)
// Works in both Node.js and Edge Runtime
// ============================================================

import * as jose from 'jose';
import type { KeycloakConfig, TokenPayload, AuthUser } from './types';

let cachedJWKS: jose.JWTVerifyGetKey | null = null;
let cachedIssuer: string | null = null;

/**
 * Get JWKS (JSON Web Key Set) from Keycloak with caching
 */
function getJWKS(config: KeycloakConfig): jose.JWTVerifyGetKey {
  if (cachedJWKS && cachedIssuer === config.issuerUrl) {
    return cachedJWKS;
  }
  const jwksUrl = new URL(`${config.issuerUrl}/protocol/openid-connect/certs`);
  cachedJWKS = jose.createRemoteJWKSet(jwksUrl);
  cachedIssuer = config.issuerUrl;
  return cachedJWKS;
}

/**
 * Verify and decode a JWT access token from Keycloak
 */
export async function verifyToken(
  token: string,
  config: KeycloakConfig
): Promise<TokenPayload> {
  const jwks = getJWKS(config);

  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: config.issuerUrl,
    audience: config.clientId,
  });

  return payload as unknown as TokenPayload;
}

/**
 * Extract AuthUser from verified token payload
 */
export function extractUser(payload: TokenPayload): AuthUser {
  const realmRoles = payload.realm_access?.roles || [];
  const clientRoles = Object.values(payload.resource_access || {})
    .flatMap(r => r.roles);
  const allRoles = [...new Set([...realmRoles, ...clientRoles])];

  // Map Keycloak roles to ERP roles
  const erpRole = allRoles.includes('admin') ? 'admin'
    : allRoles.includes('manager') ? 'manager'
    : allRoles.includes('user') ? 'user'
    : 'viewer';

  // Derive permissions from roles
  const permissions = derivePermissions(erpRole, allRoles);

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name || payload.preferred_username,
    roles: allRoles,
    tenantId: payload.tenant_id || 'default',
    tier: (payload.tier as AuthUser['tier']) || 'basic',
    permissions,
  };
}

/**
 * Derive fine-grained permissions from roles
 */
function derivePermissions(primaryRole: string, allRoles: string[]): string[] {
  const base = ['read:own'];

  switch (primaryRole) {
    case 'admin':
      return [...base, 'read:all', 'write:all', 'delete:all', 'manage:users', 'manage:settings', 'manage:billing'];
    case 'manager':
      return [...base, 'read:all', 'write:all', 'delete:own', 'manage:team'];
    case 'user':
      return [...base, 'read:team', 'write:own'];
    case 'viewer':
      return ['read:own', 'read:team'];
    default:
      return base;
  }
}

/**
 * Check if token is expired (with grace period)
 */
export function isTokenExpired(payload: TokenPayload, gracePeriodSeconds = 30): boolean {
  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now - gracePeriodSeconds;
}

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
