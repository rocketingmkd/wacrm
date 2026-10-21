import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireWrite: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireWrite: mocks.requireWrite,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: vi.fn(() => Response.json({ error: 'slow down' }, { status: 429 })),
  RATE_LIMITS: { adminAction: {} },
}));

import { DELETE } from './route';

/** A chainable stand-in for the `api_keys` table that records what ran. */
function fakeSupabase(result: { data: unknown; error?: unknown }) {
  const calls: { op: string; filters: [string, unknown][] } = { op: '', filters: [] };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    update: () => {
      calls.op = 'update';
      return chain;
    },
    delete: () => {
      calls.op = 'delete';
      return chain;
    },
    eq: (k: string, v: unknown) => {
      calls.filters.push([k, v]);
      return chain;
    },
    is: (k: string, v: unknown) => {
      calls.filters.push([k + ' is', v]);
      return chain;
    },
    select: () => chain,
    maybeSingle: async () => ({ data: result.data, error: result.error ?? null }),
  });
  return { client: { from: () => chain }, calls };
}

const params = { params: Promise.resolve({ id: 'key-1' }) };
const req = (query = '') => new Request('http://localhost/api/account/api-keys/key-1' + query, { method: 'DELETE' });

beforeEach(() => {
  mocks.requireWrite.mockReset();
  mocks.checkRateLimit.mockReset().mockReturnValue({ success: true });
});

describe('DELETE /api/account/api-keys/[id]', () => {
  it('without ?permanent it only revokes, keeping the row for the audit trail', async () => {
    const { client, calls } = fakeSupabase({ data: { id: 'key-1' } });
    mocks.requireWrite.mockResolvedValue({ supabase: client, accountId: 'acct-1', userId: 'u-1' });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(calls.op).toBe('update');
  });

  it('?permanent=1 deletes the row, scoped to the account, whatever its state', async () => {
    const { client, calls } = fakeSupabase({ data: { id: 'key-1' } });
    mocks.requireWrite.mockResolvedValue({ supabase: client, accountId: 'acct-1', userId: 'u-1' });
    const res = await DELETE(req('?permanent=1'), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(calls.op).toBe('delete');
    expect(calls.filters).toContainEqual(['id', 'key-1']);
    expect(calls.filters).toContainEqual(['account_id', 'acct-1']);
    // an already-revoked key can be deleted too, so there is no revoked_at filter
    expect(calls.filters.some(([k]) => k.startsWith('revoked_at'))).toBe(false);
  });

  it('404s a key that is not in this account', async () => {
    const { client } = fakeSupabase({ data: null });
    mocks.requireWrite.mockResolvedValue({ supabase: client, accountId: 'acct-1', userId: 'u-1' });
    const res = await DELETE(req('?permanent=1'), params);
    expect(res.status).toBe(404);
  });

  it('reports a database failure as 500 without leaking details', async () => {
    const { client } = fakeSupabase({ data: null, error: { message: 'boom: secret detail' } });
    mocks.requireWrite.mockResolvedValue({ supabase: client, accountId: 'acct-1', userId: 'u-1' });
    const res = await DELETE(req('?permanent=1'), params);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('only admins reach it: the role gate runs first', async () => {
    mocks.requireWrite.mockRejectedValue(new Error('forbidden'));
    const res = await DELETE(req('?permanent=1'), params);
    expect(res.status).toBe(403);
    expect(mocks.requireWrite).toHaveBeenCalledWith('admin');
  });

  it('is rate limited', async () => {
    const { client } = fakeSupabase({ data: { id: 'key-1' } });
    mocks.requireWrite.mockResolvedValue({ supabase: client, accountId: 'acct-1', userId: 'u-1' });
    mocks.checkRateLimit.mockReturnValue({ success: false });
    const res = await DELETE(req('?permanent=1'), params);
    expect(res.status).toBe(429);
  });
});
