// ============================================================
// @vierp/auth - Type Definitions
// ============================================================

export interface KeycloakConfig {
  issuerUrl: string;        // e.g., http://localhost:8080/realms/erp
  clientId: string;         // e.g., erp-app
  clientSecret?: string;    // For confidential clients (backend)
  redirectUri?: string;     // For authorization code flow
}

export interface TokenPayload {
  sub: string;              // Keycloak user ID
  email: string;
  name: string;
  preferred_username: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: Record<string, { roles: string[] }>;
  tenant_id?: string;
  tier?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface AuthUser {
  id: string;               // Keycloak sub
  email: string;
  name: string;
  roles: string[];
  tenantId: string;
  tier: 'basic' | 'pro' | 'enterprise';
  permissions: string[];
}

export interface AuthMiddlewareOptions {
  /**
   * Roles required to access the route.
   * If empty, any authenticated user can access.
   */
  requiredRoles?: string[];

  /**
   * Minimum tier required.
   */
  requiredTier?: 'basic' | 'pro' | 'enterprise';

  /**
   * Skip authentication (for public routes).
   */
  isPublic?: boolean;
}

export interface AuthError {
  code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'INSUFFICIENT_TIER';
  message: string;
  status: number;
}
