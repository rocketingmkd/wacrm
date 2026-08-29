import { afterEach, describe, expect, it, vi } from "vitest";

// requirePlatformAdmin resolves platform-staff status via the
// is_platform_admin() SECURITY DEFINER RPC (never a direct table
// read — platform_admins has zero RLS policies, so a direct read
// would always see nothing). Mirrors the mocking pattern in
// ./account.test.ts.

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ __isMockAdminClient: true }),
}));

function makeClient(opts: {
  user: { id: string; email?: string } | null;
  userErr?: unknown;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      rpc: (fn: string) => {
        rpcCalls.push(fn);
        return Promise.resolve(opts.rpcResult ?? { data: false, error: null });
      },
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { requirePlatformAdmin, isCurrentUserPlatformAdmin } = await import(
  "./platform"
);
const { UnauthorizedError, ForbiddenError } = await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("requirePlatformAdmin", () => {
  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null });
    createClient.mockReturnValue(client);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("throws ForbiddenError when is_platform_admin() returns false", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpcResult: { data: false, error: null },
    });
    createClient.mockReturnValue(client);
    const err = await requirePlatformAdmin().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Not a platform administrator");
  });

  it("throws ForbiddenError when the RPC itself errors", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpcResult: { data: null, error: { message: "boom" } },
    });
    createClient.mockReturnValue(client);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves a PlatformContext for a real platform admin, calling is_platform_admin via RPC (never a direct table read)", async () => {
    const { client, rpcCalls } = makeClient({
      user: { id: "user-1", email: "staff@rocketing.ia" },
      rpcResult: { data: true, error: null },
    });
    createClient.mockReturnValue(client);

    const ctx = await requirePlatformAdmin();

    expect(ctx.userId).toBe("user-1");
    expect(ctx.email).toBe("staff@rocketing.ia");
    expect(ctx.admin).toEqual({ __isMockAdminClient: true });
    expect(rpcCalls).toEqual(["is_platform_admin"]);
  });
});

describe("isCurrentUserPlatformAdmin", () => {
  it("returns false with no session, without throwing", async () => {
    const { client } = makeClient({ user: null });
    createClient.mockReturnValue(client);
    await expect(isCurrentUserPlatformAdmin()).resolves.toBe(false);
  });

  it("returns false when the RPC errors, without throwing", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpcResult: { data: null, error: { message: "boom" } },
    });
    createClient.mockReturnValue(client);
    await expect(isCurrentUserPlatformAdmin()).resolves.toBe(false);
  });

  it("returns true for a real platform admin", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      rpcResult: { data: true, error: null },
    });
    createClient.mockReturnValue(client);
    await expect(isCurrentUserPlatformAdmin()).resolves.toBe(true);
  });
});
