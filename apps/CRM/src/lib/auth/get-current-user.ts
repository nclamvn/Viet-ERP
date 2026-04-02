import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { User } from ".prisma/crm-client";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Get the current authenticated user from Supabase session + Prisma DB.
 * Use in API routes. Throws AuthError if not authenticated.
 */
export async function getCurrentUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
    error,
  } = await supabase.auth.getUser();

  if (error || !authUser) {
    throw new AuthError("Unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
  });

  if (!user) {
    throw new AuthError("User not found in database", 404);
  }

  return user;
}

/**
 * Convenience wrapper: get current user or return null (no throw).
 */
export async function getCurrentUserOrNull(): Promise<User | null> {
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}
