import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireWrite,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

/**
 * GET /api/ai/knowledge?agent_id=...
 *
 * List one agent's knowledge-base documents (any member). Each agent
 * has its own corpus (migration 046) — agent_id is required so a
 * request can never silently list a different agent's docs.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const agentId = new URL(request.url).searchParams.get('agent_id')
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, title, updated_at')
      .eq('account_id', accountId)
      .eq('agent_id', agentId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/knowledge GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load knowledge base' },
        { status: 500 },
      )
    }
    return NextResponse.json({ documents: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/knowledge  (admin+)
 *
 * Create a document for one agent, then chunk + (optionally) embed it.
 * If indexing fails the document is still saved so the admin can retry
 * via reindex.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireWrite('admin')
    const limit = checkRateLimit(`ai-kb:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const agentId = typeof body?.agent_id === 'string' ? body.agent_id : ''
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!agentId || !title || !content) {
      return NextResponse.json(
        { error: 'agent_id, title and content are required' },
        { status: 400 },
      )
    }

    // Confirm the agent belongs to this account before attaching a
    // document to it — RLS would reject the insert either way, but this
    // gives a clean 400 instead of an opaque 42501.
    const { data: agent } = await supabase
      .from('ai_agents')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', agentId)
      .maybeSingle()
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const { data: doc, error } = await supabase
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, agent_id: agentId, created_by: userId, title, content })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[ai/knowledge POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to save document' },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    try {
      await ingestDocument(
        supabase,
        accountId,
        agentId,
        { embeddingsApiKey },
        doc.id,
        content,
      )
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'indexing failed'
      console.error('[ai/knowledge POST] ingest error:', err)
      return NextResponse.json(
        {
          success: true,
          id: doc.id,
          warning: `Saved, but semantic indexing failed (${message}). Lexical search still works; use Reindex to retry.`,
        },
        { status: 200 },
      )
    }

    if (corrupt) {
      return NextResponse.json({
        success: true,
        id: doc.id,
        warning:
          'Saved with keyword search only — your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key).',
      })
    }
    return NextResponse.json({ success: true, id: doc.id })
  } catch (err) {
    return toErrorResponse(err)
  }
}
