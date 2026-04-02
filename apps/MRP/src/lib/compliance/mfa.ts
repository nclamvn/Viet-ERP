// src/lib/compliance/mfa.ts
// Multi-Factor Authentication System

import { prisma } from "@/lib/prisma";
import { Prisma } from ".prisma/mrp-client";
import { createHash, randomBytes } from "crypto";
import { logger } from "@/lib/logger";

// TOTP Configuration
const TOTP_CONFIG = {
  digits: 6,
  period: 30, // seconds
  algorithm: "SHA1",
  issuer: "VietERP MRP",
};

// Generate a random secret for TOTP
export function generateTOTPSecret(): string {
  const buffer = randomBytes(20);
  return base32Encode(buffer);
}

// Base32 encoding for TOTP secret
function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

// Base32 decoding
function base32Decode(encoded: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleanedInput = encoded.toUpperCase().replace(/=+$/, "");

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleanedInput) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

// Generate TOTP code
export async function generateTOTPCode(
  secret: string,
  timestamp?: number,
): Promise<string> {
  const time = timestamp || Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / TOTP_CONFIG.period);

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const secretBuffer = base32Decode(secret);

  // HMAC-SHA1
  const { createHmac } = await import("crypto");
  const hmac = createHmac("sha1", secretBuffer);
  hmac.update(counterBuffer);
  const hash = hmac.digest();

  // Dynamic truncation
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, TOTP_CONFIG.digits);
  return otp.toString().padStart(TOTP_CONFIG.digits, "0");
}

// Verify TOTP code (with time drift tolerance)
export async function verifyTOTPCode(
  secret: string,
  code: string,
  window: number = 1,
): Promise<boolean> {
  const time = Math.floor(Date.now() / 1000);

  // Check current and adjacent time windows
  for (let i = -window; i <= window; i++) {
    const checkTime = time + i * TOTP_CONFIG.period;
    const expectedCode = await generateTOTPCode(secret, checkTime);
    if (expectedCode === code) {
      return true;
    }
  }

  return false;
}

// Generate QR code URL for authenticator apps
export function generateTOTPQRCodeURL(
  secret: string,
  userEmail: string,
): string {
  const issuer = encodeURIComponent(TOTP_CONFIG.issuer);
  const account = encodeURIComponent(userEmail);
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=${TOTP_CONFIG.algorithm}&digits=${TOTP_CONFIG.digits}&period=${TOTP_CONFIG.period}`;
}

// Generate backup codes
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
  }
  return codes;
}

// Hash backup codes for storage
export function hashBackupCodes(codes: string[]): string[] {
  return codes.map((code) =>
    createHash("sha256").update(code.replace("-", "")).digest("hex"),
  );
}

// MFA Device Management
export interface MFASetupResult {
  success: boolean;
  deviceId?: string;
  secret?: string;
  qrCodeUrl?: string;
  backupCodes?: string[];
  error?: string;
}

// Setup MFA for a user
export async function setupMFA(
  userId: string,
  deviceName: string = "Authenticator App",
): Promise<MFASetupResult> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, mfaEnabled: true },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Generate TOTP secret
    const secret = generateTOTPSecret();
    const qrCodeUrl = generateTOTPQRCodeURL(secret, user.email);

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);
    const hashedBackupCodes = hashBackupCodes(backupCodes);

    // Create MFA device (not yet verified)
    const device = await prisma.mFADevice.create({
      data: {
        userId,
        name: deviceName,
        type: "totp",
        totpSecret: secret, // In production, encrypt this
        isVerified: false,
        isPrimary: true,
      },
    });

    // Store backup codes on user (will be enabled after verification)
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaBackupCodes: hashedBackupCodes,
        mfaMethod: "totp",
      },
    });

    return {
      success: true,
      deviceId: device.id,
      secret,
      qrCodeUrl,
      backupCodes, // Return plain codes to show user once
    };
  } catch (error) {
    logger.logError(error instanceof Error ? error : new Error(String(error)), {
      context: "mfa",
      operation: "setupMFA",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Setup failed",
    };
  }
}

// Verify MFA setup with initial code
export async function verifyMFASetup(
  userId: string,
  deviceId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const device = await prisma.mFADevice.findFirst({
      where: { id: deviceId, userId, isVerified: false },
    });

    if (!device || !device.totpSecret) {
      return { success: false, error: "Device not found or already verified" };
    }

    const isValid = await verifyTOTPCode(device.totpSecret, code);
    if (!isValid) {
      return { success: false, error: "Invalid verification code" };
    }

    // Mark device as verified and enable MFA on user
    await prisma.$transaction([
      prisma.mFADevice.update({
        where: { id: deviceId },
        data: { isVerified: true, lastUsedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      }),
    ]);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

// Verify MFA code during login
export async function verifyMFALogin(
  userId: string,
  code: string,
  ipAddress?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        mfaDevices: {
          where: { isVerified: true, isPrimary: true },
        },
      },
    });

    if (!user || !user.mfaEnabled) {
      return { success: false, error: "MFA not enabled" };
    }

    const device = user.mfaDevices[0];
    if (!device || !device.totpSecret) {
      return { success: false, error: "No MFA device configured" };
    }

    // Check if it's a backup code
    if (code.includes("-")) {
      const hashedCode = createHash("sha256")
        .update(code.replace("-", ""))
        .digest("hex");
      const backupCodes = (user.mfaBackupCodes as string[]) || [];

      const codeIndex = backupCodes.indexOf(hashedCode);
      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await prisma.user.update({
          where: { id: userId },
          data: { mfaBackupCodes: backupCodes },
        });
        return { success: true };
      }
    }

    // Verify TOTP code
    const isValid = await verifyTOTPCode(device.totpSecret, code);
    if (!isValid) {
      // Create failed challenge record
      await prisma.mFAChallenge.create({
        data: {
          userId,
          deviceId: device.id,
          type: "totp",
          status: "failed",
          attempts: 1,
          purpose: "login",
          ipAddress,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
      return { success: false, error: "Invalid verification code" };
    }

    // Update device last used
    await prisma.mFADevice.update({
      where: { id: device.id },
      data: { lastUsedAt: new Date() },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

// Create MFA challenge for sensitive actions
export async function createMFAChallenge(
  userId: string,
  purpose: string,
  ipAddress?: string,
): Promise<{ challengeId: string; expiresAt: Date } | { error: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        mfaDevices: { where: { isVerified: true, isPrimary: true } },
      },
    });

    if (!user?.mfaEnabled || !user.mfaDevices[0]) {
      return { error: "MFA not configured" };
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    const challenge = await prisma.mFAChallenge.create({
      data: {
        userId,
        deviceId: user.mfaDevices[0].id,
        type: "totp",
        status: "pending",
        purpose,
        ipAddress,
        expiresAt,
      },
    });

    return { challengeId: challenge.id, expiresAt };
  } catch {
    return { error: "Failed to create challenge" };
  }
}

// Verify MFA challenge
export async function verifyMFAChallenge(
  challengeId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const challenge = await prisma.mFAChallenge.findUnique({
      where: { id: challengeId },
      include: {
        device: true,
        user: true,
      },
    });

    if (!challenge) {
      return { success: false, error: "Challenge not found" };
    }

    if (challenge.status !== "pending") {
      return { success: false, error: "Challenge already processed" };
    }

    if (challenge.expiresAt < new Date()) {
      await prisma.mFAChallenge.update({
        where: { id: challengeId },
        data: { status: "expired" },
      });
      return { success: false, error: "Challenge expired" };
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await prisma.mFAChallenge.update({
        where: { id: challengeId },
        data: { status: "failed" },
      });
      return { success: false, error: "Maximum attempts exceeded" };
    }

    if (!challenge.device?.totpSecret) {
      return { success: false, error: "MFA device not configured" };
    }

    const isValid = await verifyTOTPCode(challenge.device.totpSecret, code);

    if (!isValid) {
      await prisma.mFAChallenge.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
      });
      return { success: false, error: "Invalid verification code" };
    }

    await prisma.mFAChallenge.update({
      where: { id: challengeId },
      data: {
        status: "verified",
        verifiedAt: new Date(),
      },
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

// Disable MFA
export async function disableMFA(
  userId: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return { success: false, error: "User not found" };
    }

    // Verify password
    const bcrypt = await import("bcryptjs");
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return { success: false, error: "Invalid password" };
    }

    // Disable MFA and remove devices
    await prisma.$transaction([
      prisma.mFADevice.deleteMany({ where: { userId } }),
      prisma.mFAChallenge.deleteMany({ where: { userId } }),
      prisma.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaMethod: null,
          mfaBackupCodes: Prisma.JsonNull,
        },
      }),
    ]);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to disable MFA",
    };
  }
}

// Get MFA status for user
export async function getMFAStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      mfaDevices: {
        select: {
          id: true,
          name: true,
          type: true,
          isVerified: true,
          isPrimary: true,
          lastUsedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const backupCodesRemaining = Array.isArray(user.mfaBackupCodes)
    ? user.mfaBackupCodes.length
    : 0;

  return {
    enabled: user.mfaEnabled,
    method: user.mfaMethod,
    devices: user.mfaDevices,
    backupCodesRemaining,
  };
}
