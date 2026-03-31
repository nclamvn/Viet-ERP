// ============================================================
// @vierp/auth - Browser Client for Keycloak SSO
// Handles login/logout redirect flow
// ============================================================

import type { KeycloakConfig, AuthSession } from './types';
import { extractUser } from './token';

const DEFAULT_CONFIG: KeycloakConfig = {
  issuerUrl: typeof window !== 'undefined'
    ? `${process.env.NEXT_PUBLIC_SSO_URL || 'http://localhost:8080'}/realms/${process.env.NEXT_PUBLIC_SSO_REALM || 'erp'}`
    : '',
  clientId: process.env.NEXT_PUBLIC_SSO_CLIENT_ID || 'erp-app',
};

/**
 * Redirect to Keycloak login page
 */
export function login(config: Partial<KeycloakConfig> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const redirectUri = config.redirectUri || window.location.origin + '/auth/callback';

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: generateState(),
  });

  window.location.href = `${cfg.issuerUrl}/protocol/openid-connect/auth?${params}`;
}

/**
 * Redirect to Keycloak logout
 */
export function logout(config: Partial<KeycloakConfig> = {}): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const redirectUri = window.location.origin;

  // Clear local session
  sessionStorage.removeItem('erp_session');

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    post_logout_redirect_uri: redirectUri,
  });

  window.location.href = `${cfg.issuerUrl}/protocol/openid-connect/logout?${params}`;
}

/**
 * Exchange authorization code for tokens (call from /auth/callback page)
 */
export async function handleCallback(
  code: string,
  config: Partial<KeycloakConfig> = {}
): Promise<AuthSession> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const redirectUri = config.redirectUri || window.location.origin + '/auth/callback';

  const response = await fetch(`${cfg.issuerUrl}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  const data = await response.json();
  const payload = parseJwtPayload(data.access_token);
  const user = extractUser(payload);

  const session: AuthSession = {
    user,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Store session
  sessionStorage.setItem('erp_session', JSON.stringify(session));
  return session;
}

/**
 * Get current session (from sessionStorage)
 */
export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem('erp_session');
  if (!raw) return null;

  const session: AuthSession = JSON.parse(raw);
  if (Date.now() > session.expiresAt) {
    sessionStorage.removeItem('erp_session');
    return null;
  }
  return session;
}

/**
 * Get access token for API calls
 */
export function getAccessToken(): string | null {
  const session = getSession();
  return session?.accessToken || null;
}

/**
 * Refresh the access token using refresh token
 */
export async function refreshSession(
  config: Partial<KeycloakConfig> = {}
): Promise<AuthSession | null> {
  const session = getSession();
  if (!session?.refreshToken) return null;

  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    const response = await fetch(`${cfg.issuerUrl}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        refresh_token: session.refreshToken,
      }),
    });

    if (!response.ok) {
      sessionStorage.removeItem('erp_session');
      return null;
    }

    const data = await response.json();
    const payload = parseJwtPayload(data.access_token);
    const user = extractUser(payload);

    const newSession: AuthSession = {
      user,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    sessionStorage.setItem('erp_session', JSON.stringify(newSession));
    return newSession;
  } catch {
    sessionStorage.removeItem('erp_session');
    return null;
  }
}

// ==================== Helpers ====================

function generateState(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function parseJwtPayload(token: string): any {
  const base64 = token.split('.')[1];
  const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}
