import { EVENT_LABELS } from './conversions'

export const EVENT_NAMES = Object.keys(EVENT_LABELS)

export interface RuleInput {
  id?: string
  stage_id?: string | null
  on_status?: 'won' | null
  event_name: string
  send_value: boolean
  enabled: boolean
  /** Google Ads conversion action that receives this event (digits). */
  google_action_id: string | null
}

export interface SettingsInput {
  meta_dataset_id: string | null
  meta_enabled: boolean
  meta_test_code: string | null
  google_enabled: boolean
  /** Google validates the request but imports nothing. */
  google_validate_only: boolean
  rules: RuleInput[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RULES = 30

/**
 * Validates the body of PUT /api/conversions/settings. Returns the clean
 * value or a Portuguese message for the first problem found.
 */
export function parseSettingsInput(raw: unknown): { ok: true; value: SettingsInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Dados inválidos.' }
  const body = raw as Record<string, unknown>

  const datasetRaw = typeof body.meta_dataset_id === 'string' ? body.meta_dataset_id.trim() : ''
  if (datasetRaw && !/^\d{5,25}$/.test(datasetRaw)) {
    return { ok: false, error: 'O ID do dataset (Pixel) deve ter só números.' }
  }
  const enabled = body.meta_enabled === true
  if (enabled && !datasetRaw) {
    return { ok: false, error: 'Informe o ID do dataset (Pixel) para ligar o envio.' }
  }
  const testRaw = typeof body.meta_test_code === 'string' ? body.meta_test_code.trim() : ''
  if (testRaw && !/^[A-Za-z0-9_-]{3,40}$/.test(testRaw)) {
    return { ok: false, error: 'O código de teste está em formato inválido.' }
  }

  const googleEnabled = body.google_enabled === true
  // Safe by default: only an explicit false turns the test mode off.
  const googleValidateOnly = body.google_validate_only !== false

  if (!Array.isArray(body.rules) || body.rules.length > MAX_RULES) {
    return { ok: false, error: 'Regras inválidas.' }
  }
  const rules: RuleInput[] = []
  const seen = new Set<string>()
  for (const r of body.rules as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') return { ok: false, error: 'Regra inválida.' }
    const eventName = String(r.event_name ?? '')
    if (!EVENT_NAMES.includes(eventName)) return { ok: false, error: 'Evento desconhecido em uma regra.' }
    const stageId = typeof r.stage_id === 'string' && r.stage_id ? r.stage_id : null
    const onStatus = r.on_status === 'won' ? 'won' : null
    if ((stageId === null) === (onStatus === null)) {
      return { ok: false, error: 'Cada regra precisa de um estágio ou do status "ganho".' }
    }
    if (stageId && !UUID.test(stageId)) return { ok: false, error: 'Estágio inválido.' }
    const googleRaw = typeof r.google_action_id === 'string' ? r.google_action_id.replace(/\D/g, '') : ''
    if (googleRaw && (googleRaw.length < 5 || googleRaw.length > 20)) {
      return { ok: false, error: 'O ID da ação de conversão do Google deve ter só números.' }
    }
    const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : undefined
    const trigger = `${stageId ?? ''}|${onStatus ?? ''}|${eventName}`
    if (seen.has(trigger)) return { ok: false, error: 'Há regras repetidas.' }
    seen.add(trigger)
    rules.push({
      id,
      stage_id: stageId,
      on_status: onStatus,
      event_name: eventName,
      send_value: r.send_value === true,
      enabled: r.enabled !== false,
      google_action_id: googleRaw || null,
    })
  }

  if (googleEnabled && !rules.some((r) => r.enabled && r.google_action_id)) {
    return { ok: false, error: 'Para ligar o envio ao Google, preencha o ID da ação de conversão em pelo menos uma regra ativa.' }
  }

  return {
    ok: true,
    value: {
      meta_dataset_id: datasetRaw || null,
      meta_enabled: enabled,
      meta_test_code: testRaw || null,
      google_enabled: googleEnabled,
      google_validate_only: googleValidateOnly,
      rules,
    },
  }
}
