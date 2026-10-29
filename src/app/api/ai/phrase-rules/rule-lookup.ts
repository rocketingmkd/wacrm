import type { SupabaseClient } from '@supabase/supabase-js'
import type { PhraseRule } from '@/lib/tracking/phrase-rules'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One rule by id, scoped to the session's account. Null when the id is
 *  malformed or belongs to another account. */
export async function loadRuleForAccount(
  db: SupabaseClient,
  accountId: string,
  ruleId: unknown,
): Promise<PhraseRule | null> {
  if (typeof ruleId !== 'string' || !UUID_RE.test(ruleId)) return null
  const { data } = await db
    .from('attribution_phrase_rules')
    .select('id, phrase, source, label')
    .eq('id', ruleId)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as PhraseRule | null) ?? null
}
