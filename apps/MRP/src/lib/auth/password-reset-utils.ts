// =============================================================================
// PASSWORD RESET TOKEN UTILITIES
// Shared validation logic for forgot-password and reset-password routes
// =============================================================================

import prisma from "@/lib/prisma";
import type { PasswordResetToken, User } from ".prisma/mrp-client";

// =============================================================================
// TYPES
// =============================================================================

/** Token record with basic fields (used by GET validation) */
export interface ValidatedToken {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/** Token record including the associated user (used by POST reset) */
export interface ValidatedTokenWithUser extends ValidatedToken {
  user: Pick<User, "id" | "email" | "password">;
}

/** Error thrown when token validation fails */
export class TokenValidationError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "ALREADY_USED" | "EXPIRED",
  ) {
    super(message);
    this.name = "TokenValidationError";
  }
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a password reset token: checks existence, usage, and expiry.
 * Returns the token record or throws a TokenValidationError.
 */
export async function validateResetToken(
  token: string,
): Promise<ValidatedToken> {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!resetToken) {
    throw new TokenValidationError(
      "Token khong ton tai hoac da het han",
      "NOT_FOUND",
    );
  }

  if (resetToken.usedAt) {
    throw new TokenValidationError("Token da duoc su dung", "ALREADY_USED");
  }

  if (new Date() > resetToken.expiresAt) {
    throw new TokenValidationError("Token da het han", "EXPIRED");
  }

  return resetToken;
}

/**
 * Validate a password reset token and include the associated user record.
 * Returns the token with user data or throws a TokenValidationError.
 */
export async function validateResetTokenWithUser(
  token: string,
): Promise<ValidatedTokenWithUser> {
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, password: true } } },
  });

  if (!resetToken) {
    throw new TokenValidationError("Token khong ton tai", "NOT_FOUND");
  }

  if (resetToken.usedAt) {
    throw new TokenValidationError("Token da duoc su dung", "ALREADY_USED");
  }

  if (new Date() > resetToken.expiresAt) {
    throw new TokenValidationError("Token da het han", "EXPIRED");
  }

  return resetToken as ValidatedTokenWithUser;
}
