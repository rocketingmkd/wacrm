// ============================================================
// /api/account/round-robin
//
//   GET   — current on/off state.        Any member.
//   PATCH — flip the switch.             Admin+.
//
// Backs the "Automatic agent round-robin" toggle in Settings →
// Members. When on, every brand-new conversation gets auto-assigned
// to the next 'agent'-role member in line — see
// `maybeAssignRoundRobin` (src/lib/conversations/round-robin.ts),
// called from the WhatsApp webhook right after a conversation row
// is first created.
// ============================================================

import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("accounts")
      .select("round_robin_enabled")
      .eq("id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/round-robin] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load round-robin setting" },
        { status: 500 },
      );
    }

    return NextResponse.json({ enabled: data?.round_robin_enabled ?? false });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:roundRobin:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { enabled?: unknown }
      | null;
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json(
        { error: "'enabled' must be a boolean" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase
      .from("accounts")
      .update({ round_robin_enabled: body.enabled })
      .eq("id", ctx.accountId);

    if (error) {
      console.error("[PATCH /api/account/round-robin] update error:", error);
      return NextResponse.json(
        { error: "Failed to update round-robin setting" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (err) {
    return toErrorResponse(err);
  }
}
