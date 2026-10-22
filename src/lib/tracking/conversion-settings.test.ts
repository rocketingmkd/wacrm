import { describe, expect, it } from 'vitest'
import { parseSettingsInput } from './conversion-settings'

const STAGE = '11111111-1111-4111-8111-111111111111'
const RULE = '22222222-2222-4222-8222-222222222222'

const ok = (body: unknown) => {
  const out = parseSettingsInput(body)
  if (!out.ok) throw new Error(out.error)
  return out.value
}
const err = (body: unknown) => {
  const out = parseSettingsInput(body)
  return out.ok ? null : out.error
}

describe('parseSettingsInput', () => {
  it('accepts a full valid body and normalises it', () => {
    const v = ok({
      meta_dataset_id: ' 123456789012345 ',
      meta_enabled: true,
      meta_test_code: 'TEST123',
      rules: [
        { id: RULE, stage_id: STAGE, event_name: 'Lead', send_value: false, enabled: true },
        { on_status: 'won', event_name: 'Purchase', send_value: true },
      ],
    })
    expect(v.meta_dataset_id).toBe('123456789012345')
    expect(v.rules[0]).toMatchObject({ id: RULE, stage_id: STAGE, on_status: null })
    expect(v.rules[1]).toMatchObject({ stage_id: null, on_status: 'won', enabled: true, send_value: true })
  })

  it('allows saving with sending off and no dataset', () => {
    expect(ok({ meta_enabled: false, rules: [] })).toMatchObject({ meta_dataset_id: null, meta_enabled: false })
  })

  it('requires a dataset to turn sending on', () => {
    expect(err({ meta_enabled: true, rules: [] })).toMatch(/ID do dataset/)
  })

  it.each(['abc', '12', '12 34 56 78', '123456789012345678901234567890'])('rejects dataset id %j', (id) => {
    expect(err({ meta_dataset_id: id, rules: [] })).toMatch(/só números/)
  })

  it('rejects an unknown event', () => {
    expect(err({ rules: [{ stage_id: STAGE, event_name: 'Hack' }] })).toMatch(/Evento desconhecido/)
  })

  it('needs exactly one trigger per rule', () => {
    expect(err({ rules: [{ event_name: 'Lead' }] })).toMatch(/estágio ou do status/)
    expect(err({ rules: [{ stage_id: STAGE, on_status: 'won', event_name: 'Lead' }] })).toMatch(/estágio ou do status/)
  })

  it('rejects a malformed stage id and repeated rules', () => {
    expect(err({ rules: [{ stage_id: 'x', event_name: 'Lead' }] })).toMatch(/Estágio inválido/)
    expect(
      err({
        rules: [
          { stage_id: STAGE, event_name: 'Lead' },
          { stage_id: STAGE, event_name: 'Lead' },
        ],
      }),
    ).toMatch(/repetidas/)
  })

  it('rejects non-object bodies and a bad test code', () => {
    expect(err(null)).toMatch(/inválidos/)
    expect(err({ meta_test_code: 'a b', rules: [] })).toMatch(/código de teste/)
  })
})

describe('google fields', () => {
  const rule = { stage_id: STAGE, event_name: 'Lead', google_action_id: '987-654-32' }

  it('keeps only the digits of the conversion action id', () => {
    const v = ok({ rules: [rule] })
    expect(v.rules[0].google_action_id).toBe('98765432')
    expect(v.google_enabled).toBe(false)
  })

  it('starts in test mode unless it is turned off on purpose', () => {
    expect(ok({ rules: [] }).google_validate_only).toBe(true)
    expect(ok({ google_validate_only: false, rules: [] }).google_validate_only).toBe(false)
  })

  it('needs an active rule with an action id to turn Google on', () => {
    expect(err({ google_enabled: true, rules: [{ stage_id: STAGE, event_name: 'Lead' }] })).toMatch(/ação de conversão/)
    expect(ok({ google_enabled: true, rules: [rule] }).google_enabled).toBe(true)
  })

  it('rejects a too short action id', () => {
    expect(err({ rules: [{ ...rule, google_action_id: '12' }] })).toMatch(/só números/)
  })
})
