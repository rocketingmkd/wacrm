import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseSettingsInput } from '@/lib/tracking/conversion-settings'

/**
 * GET /api/conversions/settings: Meta dataset settings, the rules, the
 * stages of the sales pipelines and the latest queued events.
 * PUT /api/conversions/settings: saves settings and replaces the rules.
 * Admin only; every read and write goes through RLS.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const [settings, rules, pipelines, recent] = await Promise.all([
      supabase
        .from('conversion_settings')
        .select('meta_dataset_id, meta_enabled, meta_test_code, google_enabled, google_validate_only')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('conversion_rules')
        .select('id, stage_id, on_status, event_name, send_value, enabled, google_action_id')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true }),
      supabase
        .from('pipelines')
        .select('id, name, is_scheduling, pipeline_stages(id, name, position)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true }),
      supabase
        .from('conversion_events')
        .select('id, event_name, value, currency, status, detail, occurred_at, sent_at, deal:deals(title)')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const stages = (pipelines.data ?? [])
      .filter((p) => !p.is_scheduling)
      .flatMap((p) =>
        [...((p.pipeline_stages as { id: string; name: string; position: number }[]) ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((s) => ({ id: s.id, name: s.name, pipeline: p.name as string })),
      )

    return NextResponse.json({
      settings: settings.data ?? {
        meta_dataset_id: null,
        meta_enabled: false,
        meta_test_code: null,
        google_enabled: false,
        google_validate_only: true,
      },
      rules: rules.data ?? [],
      stages,
      recent: recent.data ?? [],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const parsed = parseSettingsInput(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const input = parsed.value

    // Every stage in a rule must belong to this account's sales pipelines.
    const stageIds = input.rules.map((r) => r.stage_id).filter((s): s is string => Boolean(s))
    if (stageIds.length > 0) {
      const { data: valid } = await supabase
        .from('pipeline_stages')
        .select('id, pipelines!inner(account_id, is_scheduling)')
        .in('id', stageIds)
        .eq('pipelines.account_id', accountId)
        .eq('pipelines.is_scheduling', false)
      if ((valid ?? []).length !== new Set(stageIds).size) {
        return NextResponse.json({ error: 'Um dos estágios não pertence aos seus funis de vendas.' }, { status: 400 })
      }
    }

    const { error: settingsError } = await supabase.from('conversion_settings').upsert(
      {
        account_id: accountId,
        meta_dataset_id: input.meta_dataset_id,
        meta_enabled: input.meta_enabled,
        meta_test_code: input.meta_test_code,
        google_enabled: input.google_enabled,
        google_validate_only: input.google_validate_only,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    if (settingsError) {
      console.error('[conversions/settings] save failed:', settingsError.message)
      return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
    }

    // Rules keep their id when the client sends it, so events already
    // queued for a rule are not orphaned and deals do not fire twice.
    const { data: existing } = await supabase
      .from('conversion_rules')
      .select('id')
      .eq('account_id', accountId)
    const keep = new Set(input.rules.map((r) => r.id).filter((id): id is string => Boolean(id)))
    const toDelete = (existing ?? []).map((r) => r.id as string).filter((id) => !keep.has(id))
    if (toDelete.length > 0) {
      await supabase.from('conversion_rules').delete().eq('account_id', accountId).in('id', toDelete)
    }

    for (const r of input.rules) {
      const row = {
        account_id: accountId,
        stage_id: r.stage_id ?? null,
        on_status: r.on_status ?? null,
        event_name: r.event_name,
        send_value: r.send_value,
        enabled: r.enabled,
        google_action_id: r.google_action_id,
      }
      const { error } = r.id
        ? await supabase.from('conversion_rules').update(row).eq('id', r.id).eq('account_id', accountId)
        : await supabase.from('conversion_rules').insert(row)
      if (error) {
        console.error('[conversions/settings] rule save failed:', error.message)
        return NextResponse.json({ error: 'Não foi possível salvar as regras.' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
