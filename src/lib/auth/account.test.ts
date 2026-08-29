import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          opts.byTable[table] ?? { data: null, error: null },
        );
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const isAccountWriteLocked = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock("@/lib/billing/write-lock", () => ({
  isAccountWriteLocked: (...args: unknown[]) => isAccountWriteLocked(...args),
}));

const checkAccountFeature = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock("@/lib/billing/feature-gate", () => ({
  checkAccountFeature: (...args: unknown[]) => checkAccountFeature(...args),
}));

const {
  getCurrentAccount,
  requireWrite,
  requireFeature,
  requireWriteFeature,
  UnauthorizedError,
  ForbiddenError,
  PaymentRequiredError,
  FeatureNotAvailableError,
  toErrorResponse,
} = await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Could not load account context");
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});

describe("requireWrite", () => {
  function makeWritableClient(role = "agent") {
    return makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: "acct-1", account_role: role }, error: null },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
  }

  it("resolves the context when the account is not write-locked", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(false);

    const ctx = await requireWrite("agent");
    expect(ctx.accountId).toBe("acct-1");
    expect(isAccountWriteLocked).toHaveBeenCalledWith(client, "acct-1");
  });

  it("throws PaymentRequiredError when the account is write-locked", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(true);

    await expect(requireWrite("agent")).rejects.toBeInstanceOf(PaymentRequiredError);
  });

  it("still enforces the role check before even looking at billing", async () => {
    const { client } = makeWritableClient("viewer");
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(false);

    await expect(requireWrite("agent")).rejects.toBeInstanceOf(ForbiddenError);
    expect(isAccountWriteLocked).not.toHaveBeenCalled();
  });
});

describe("requireFeature / requireWriteFeature", () => {
  function makeWritableClient(role = "agent") {
    return makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: "acct-1", account_role: role }, error: null },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
  }

  it("requireFeature resolves when the plan has the feature, without checking billing lock", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    checkAccountFeature.mockResolvedValue(true);

    const ctx = await requireFeature("agent", "flows");
    expect(ctx.accountId).toBe("acct-1");
    expect(checkAccountFeature).toHaveBeenCalledWith(client, "acct-1", "flows");
    expect(isAccountWriteLocked).not.toHaveBeenCalled();
  });

  it("requireFeature throws FeatureNotAvailableError when the plan lacks it", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    checkAccountFeature.mockResolvedValue(false);

    await expect(requireFeature("agent", "aiCopilot")).rejects.toBeInstanceOf(
      FeatureNotAvailableError,
    );
  });

  it("requireWriteFeature checks billing lock first, then the feature", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(false);
    checkAccountFeature.mockResolvedValue(true);

    const ctx = await requireWriteFeature("agent", "apiAccess");
    expect(ctx.accountId).toBe("acct-1");
    expect(isAccountWriteLocked).toHaveBeenCalled();
    expect(checkAccountFeature).toHaveBeenCalledWith(client, "acct-1", "apiAccess");
  });

  it("requireWriteFeature throws PaymentRequiredError before ever checking the feature, when locked", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(true);

    await expect(requireWriteFeature("agent", "flows")).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
    expect(checkAccountFeature).not.toHaveBeenCalled();
  });

  it("requireWriteFeature throws FeatureNotAvailableError when not locked but the plan lacks the feature", async () => {
    const { client } = makeWritableClient();
    createClient.mockReturnValue(client);
    isAccountWriteLocked.mockResolvedValue(false);
    checkAccountFeature.mockResolvedValue(false);

    await expect(requireWriteFeature("agent", "flows")).rejects.toBeInstanceOf(
      FeatureNotAvailableError,
    );
  });
});

describe("toErrorResponse", () => {
  it("maps PaymentRequiredError to 402 with a stable error code", async () => {
    const res = toErrorResponse(new PaymentRequiredError());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toEqual({ error: "Account is read-only", code: "account_read_only" });
  });

  it("maps FeatureNotAvailableError to 403 with a stable error code", async () => {
    const res = toErrorResponse(new FeatureNotAvailableError());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      error: "This feature requires the Pro plan",
      code: "plan_upgrade_required",
    });
  });
});
