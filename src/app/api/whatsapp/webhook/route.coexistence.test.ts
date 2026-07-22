import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Coexistence-only webhook topics added alongside the standard
// messages/statuses handling: smb_message_echoes (messages sent from the
// customer's own WhatsApp Business app), smb_app_state_sync (their app
// contacts), history (one-time backfill), and account_update (disconnect /
// reconnect). See the plan at .claude/plans/eager-kindling-falcon.md for the
// full rationale.
// ---------------------------------------------------------------------------

const SECRET = process.env.META_APP_SECRET!
const BUSINESS_PHONE = '15550001111'
const CUSTOMER_PHONE = '5511999998888'

function signedRequest(payload: unknown): Request {
  const body = JSON.stringify(payload)
  const signature =
    'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
    body,
  })
}

// ---- recorded side effects, reset in beforeEach ----
const messageInserts: Array<Record<string, unknown>> = []
const messageUpdates: Array<{ eqs: [string, unknown][]; patch: Record<string, unknown> }> = []
const contactInserts: Array<Record<string, unknown>> = []
const conversationInserts: Array<Record<string, unknown>> = []
const conversationUpdates: Array<{ eqs: [string, unknown][]; patch: Record<string, unknown> }> = []
const configUpdates: Array<{ eqs: [string, unknown][]; patch: Record<string, unknown> }> = []

let configRow: Record<string, unknown> | null = null
// Controls the dedup check inside handleHistorySync — non-null simulates a
// message already stored (from live Cloud API traffic or a redelivered chunk).
let existingMessageRow: Record<string, unknown> | null = null
// Controls findOrCreateConversation's lookup — null forces the create path,
// which is what every test below exercises.
let existingConversationRow: Record<string, unknown> | null = null

function makeSupabaseMock() {
  function builder(table: string) {
    const eqs: [string, unknown][] = []
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Record<string, unknown> = {}

    const resolveSelect = () => {
      if (table === 'whatsapp_config') {
        return { data: configRow ? [configRow] : [], error: null }
      }
      if (table === 'messages') {
        return { data: existingMessageRow, error: null }
      }
      if (table === 'conversations') {
        return { data: existingConversationRow ? [existingConversationRow] : [], error: null }
      }
      return { data: null, error: null }
    }

    const resolveInsert = () => {
      if (table === 'messages') {
        messageInserts.push(payload)
        return { data: { id: 'msg-new', ...payload }, error: null }
      }
      if (table === 'contacts') {
        contactInserts.push(payload)
        return {
          data: {
            id: 'contact-new',
            account_id: payload.account_id,
            phone: payload.phone,
            name: payload.name,
          },
          error: null,
        }
      }
      if (table === 'conversations') {
        conversationInserts.push(payload)
        return {
          data: {
            id: 'conv-new',
            account_id: payload.account_id,
            contact_id: payload.contact_id,
            unread_count: 0,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const resolveUpdate = () => {
      if (table === 'messages') messageUpdates.push({ eqs: [...eqs], patch: payload })
      if (table === 'conversations') conversationUpdates.push({ eqs: [...eqs], patch: payload })
      if (table === 'whatsapp_config') configUpdates.push({ eqs: [...eqs], patch: payload })
      return { error: null }
    }

    const resolve = () =>
      mode === 'insert' ? resolveInsert() : mode === 'update' ? resolveUpdate() : resolveSelect()

    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = vi.fn(chain)
    b.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val])
      return b
    })
    b.is = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val])
      return b
    })
    b.in = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val])
      return b
    })
    b.order = vi.fn(chain)
    b.limit = vi.fn(chain)
    b.insert = vi.fn((p: Record<string, unknown>) => {
      mode = 'insert'
      payload = p
      return b
    })
    b.update = vi.fn((p: Record<string, unknown>) => {
      mode = 'update'
      payload = p
      return b
    })
    b.single = vi.fn(() => Promise.resolve(resolve()))
    b.maybeSingle = vi.fn(() => Promise.resolve(resolve()))
    b.then = (resolveFn: (v: unknown) => unknown) => resolveFn(resolve())
    return b
  }

  return { from: vi.fn((table: string) => builder(table)) }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supabaseMock),
}))

// findExistingContact bypassed (always "not found" — every test exercises
// the create path) so the mock above doesn't need to replicate the real
// phone-suffix matching SQL.
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => null),
  isUniqueViolation: vi.fn(() => false),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {}),
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async () => ({ consumed: false })),
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {}),
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(async () => {}),
}))
vi.mock('@/lib/conversations/round-robin', () => ({
  maybeAssignRoundRobin: vi.fn(async () => {}),
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: vi.fn(() => false),
  handleTemplateWebhookChange: vi.fn(async () => {}),
}))

// `after()` normally hands its callback to the Next.js runtime, which keeps
// the function alive independently of the response. Under vitest there's no
// such runtime, so capture the promise here and await it in each test right
// after POST resolves — otherwise assertions would race the still-pending
// processWebhook() work.
const { mockAfter, getLastAfterPromise } = vi.hoisted(() => {
  let pending: Promise<unknown> = Promise.resolve()
  return {
    mockAfter: (cb: () => unknown) => {
      pending = Promise.resolve().then(cb)
    },
    getLastAfterPromise: () => pending,
  }
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: mockAfter }
})

import { encrypt } from '@/lib/whatsapp/encryption'
import { POST } from './route'

async function postWebhook(field: string, value: unknown) {
  const res = await POST(
    signedRequest({
      entry: [{ id: 'waba-1', changes: [{ field, value }] }],
    }),
  )
  await getLastAfterPromise()
  return res
}

describe('Coexistence webhook topics', () => {
  beforeEach(() => {
    messageInserts.length = 0
    messageUpdates.length = 0
    contactInserts.length = 0
    conversationInserts.length = 0
    conversationUpdates.length = 0
    configUpdates.length = 0
    existingMessageRow = null
    existingConversationRow = null
    configRow = {
      id: 'cfg-1',
      account_id: 'acct-1',
      user_id: 'user-1',
      phone_number_id: 'PNID-1',
      waba_id: 'waba-1',
      access_token: encrypt('plaintext-token'),
      contacts_synced_at: null,
      history_synced_at: null,
    }
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('smb_message_echoes', () => {
    it('mirrors a normal text echo as an agent message with origin=whatsapp_app', async () => {
      const res = await postWebhook('smb_message_echoes', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        message_echoes: [
          {
            from: BUSINESS_PHONE,
            to: CUSTOMER_PHONE,
            id: 'wamid-echo-1',
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'Oi, cliente! Aqui é a loja.' },
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(contactInserts).toHaveLength(1)
      expect(contactInserts[0]).toMatchObject({
        account_id: 'acct-1',
        phone: CUSTOMER_PHONE,
      })
      expect(conversationInserts).toHaveLength(1)
      expect(messageInserts).toHaveLength(1)
      expect(messageInserts[0]).toMatchObject({
        sender_type: 'agent',
        origin: 'whatsapp_app',
        content_type: 'text',
        content_text: 'Oi, cliente! Aqui é a loja.',
        message_id: 'wamid-echo-1',
        status: 'sent',
      })
      expect(conversationUpdates).toHaveLength(1)
      expect(conversationUpdates[0].patch).toMatchObject({
        last_message_text: 'Oi, cliente! Aqui é a loja.',
      })
    })

    it('patches the original row on a revoke echo instead of inserting', async () => {
      const res = await postWebhook('smb_message_echoes', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        message_echoes: [
          {
            from: BUSINESS_PHONE,
            to: CUSTOMER_PHONE,
            id: 'wamid-echo-revoke',
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'revoke',
            revoke: { original_message_id: 'wamid-original' },
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(messageInserts).toHaveLength(0)
      expect(messageUpdates).toHaveLength(1)
      expect(messageUpdates[0].eqs).toContainEqual(['message_id', 'wamid-original'])
      expect(messageUpdates[0].patch.media_url).toBeNull()
      expect(String(messageUpdates[0].patch.content_text)).toMatch(/apagada/)
    })

    it('patches the original row with new content on an edit echo', async () => {
      const res = await postWebhook('smb_message_echoes', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        message_echoes: [
          {
            from: BUSINESS_PHONE,
            to: CUSTOMER_PHONE,
            id: 'wamid-echo-edit',
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'edit',
            edit: {
              original_message_id: 'wamid-original-2',
              message: { type: 'text', text: { body: 'Texto corrigido' } },
            },
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(messageInserts).toHaveLength(0)
      expect(messageUpdates).toHaveLength(1)
      expect(messageUpdates[0].eqs).toContainEqual(['message_id', 'wamid-original-2'])
      expect(messageUpdates[0].patch.content_text).toBe('Texto corrigido')
    })
  })

  describe('smb_app_state_sync', () => {
    it('creates/updates a contact for an "add" entry and marks contacts_synced_at', async () => {
      const res = await postWebhook('smb_app_state_sync', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        state_sync: [
          {
            type: 'contact',
            contact: { full_name: 'Maria Silva', phone_number: CUSTOMER_PHONE },
            action: 'add',
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(contactInserts).toHaveLength(1)
      expect(contactInserts[0]).toMatchObject({
        account_id: 'acct-1',
        phone: CUSTOMER_PHONE,
        name: 'Maria Silva',
      })
      const syncUpdate = configUpdates.find((u) => 'contacts_synced_at' in u.patch)
      expect(syncUpdate).toBeDefined()
      expect(syncUpdate!.eqs).toContainEqual(['id', 'cfg-1'])
    })

    it('does not touch the contact for a "remove" entry', async () => {
      const res = await postWebhook('smb_app_state_sync', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        state_sync: [
          {
            type: 'contact',
            contact: { phone_number: CUSTOMER_PHONE },
            action: 'remove',
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(contactInserts).toHaveLength(0)
    })
  })

  describe('history', () => {
    it('imports a backfilled message with origin=history_import', async () => {
      const res = await postWebhook('history', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 50 },
            threads: [
              {
                id: CUSTOMER_PHONE,
                messages: [
                  {
                    from: BUSINESS_PHONE,
                    to: CUSTOMER_PHONE,
                    id: 'wamid-hist-1',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Mensagem antiga do histórico' },
                  },
                ],
              },
            ],
          },
        ],
      })

      expect(res.status).toBe(200)
      expect(messageInserts).toHaveLength(1)
      expect(messageInserts[0]).toMatchObject({
        sender_type: 'agent',
        origin: 'history_import',
        content_text: 'Mensagem antiga do histórico',
        message_id: 'wamid-hist-1',
        status: 'delivered',
      })
      // Backfill must never overwrite live conversation state.
      expect(conversationUpdates).toHaveLength(0)
      // progress !== 100 and phase !== 2 — sync not yet complete.
      expect(configUpdates.some((u) => 'history_synced_at' in u.patch)).toBe(false)
    })

    it('marks history_synced_at once progress reaches 100', async () => {
      await postWebhook('history', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        history: [
          {
            metadata: { phase: 2, chunk_order: 9, progress: 100 },
            threads: [],
          },
        ],
      })

      const syncUpdate = configUpdates.find((u) => 'history_synced_at' in u.patch)
      expect(syncUpdate).toBeDefined()
      expect(syncUpdate!.eqs).toContainEqual(['id', 'cfg-1'])
    })

    it('skips a message whose message_id already exists (dedup across redelivered chunks)', async () => {
      existingMessageRow = { id: 'already-there' }

      await postWebhook('history', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        history: [
          {
            metadata: { phase: 0, chunk_order: 1, progress: 10 },
            threads: [
              {
                id: CUSTOMER_PHONE,
                messages: [
                  {
                    from: CUSTOMER_PHONE,
                    to: BUSINESS_PHONE,
                    id: 'wamid-dup',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Já recebida ao vivo' },
                  },
                ],
              },
            ],
          },
        ],
      })

      expect(messageInserts).toHaveLength(0)
    })

    it('does not import anything when the customer declined to share history', async () => {
      await postWebhook('history', {
        metadata: { display_phone_number: BUSINESS_PHONE, phone_number_id: 'PNID-1' },
        history: [
          {
            errors: [
              {
                code: 2593109,
                title: 'History sync turned off by business',
                message: 'History sharing disabled from WhatsApp Business App',
              },
            ],
          },
        ],
      })

      expect(messageInserts).toHaveLength(0)
      expect(contactInserts).toHaveLength(0)
    })
  })

  describe('account_update', () => {
    it('marks the config disconnected on PARTNER_REMOVED', async () => {
      const res = await postWebhook('account_update', {
        event: 'PARTNER_REMOVED',
        waba_info: { waba_id: 'waba-1' },
        disconnection_info: { reason: 'ACCOUNT_DISCONNECTED', initiated_by: 'USER' },
      })

      expect(res.status).toBe(200)
      const update = configUpdates.find((u) => u.patch.status === 'disconnected')
      expect(update).toBeDefined()
      expect(update!.eqs).toContainEqual(['id', ['cfg-1']])
    })

    it('marks the config connected again on ACCOUNT_RECONNECTED', async () => {
      const res = await postWebhook('account_update', {
        event: 'ACCOUNT_RECONNECTED',
        waba_info: { waba_id: 'waba-1' },
      })

      expect(res.status).toBe(200)
      const update = configUpdates.find((u) => u.patch.status === 'connected')
      expect(update).toBeDefined()
    })
  })
})
