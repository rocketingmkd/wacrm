// ============================================================
// GET /api/v1/traffic — where leads came from (scope: traffic:read)
//
// The same report behind the "Origem do tráfego" page, for an API key:
// leads, deals and revenue per ad source and campaign, plus the latest
// leads with their origin. Read-only.
//
// Query: `?from=<ISO>&to=<ISO>&tz=<IANA zone>`. Defaults to the last 30
// days in America/Sao_Paulo. The range is capped like the dashboard's
// (see validateRange).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { validateRange } from '@/lib/reports';
import type { AttributionReport } from '@/lib/tracking/report';

const DAY_MS = 86_400_000;

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'traffic:read');
    const url = new URL(request.url);

    const to = url.searchParams.get('to') ? new Date(url.searchParams.get('to')!) : new Date();
    const from = url.searchParams.get('from')
      ? new Date(url.searchParams.get('from')!)
      : new Date(to.getTime() - 30 * DAY_MS);
    const problem = validateRange(from, to);
    if (problem) return fail('bad_request', problem, 400);

    const tzParam = url.searchParams.get('tz') ?? '';
    const tz =
      /^[A-Za-z]+(?:[_/+-][A-Za-z0-9_+-]+)*$/.test(tzParam) && tzParam.length <= 64
        ? tzParam
        : 'America/Sao_Paulo';

    // attribution_report accepts the service role (migration 074); the
    // account is fixed by the key, never by the caller.
    const { data, error } = await ctx.supabase.rpc('attribution_report', {
      p_account: ctx.accountId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
      p_tz: tz,
    });
    if (error) {
      console.error('[api/v1/traffic] rpc failed:', error.message);
      return fail('internal', 'Failed to build the traffic report', 500);
    }
    return ok({ from: from.toISOString(), to: to.toISOString(), tz, ...(data as AttributionReport) });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
