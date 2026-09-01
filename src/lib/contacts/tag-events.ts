import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runAutomationsForTrigger,
  type AutomationContext,
} from '@/lib/automations/engine';
// Deliberate cycle: src/lib/flows/engine.ts already imports
// addContactTagAndDispatch (below) from this file, for its own
// set_tag node. This import closes that loop. Verified safe — no
// import/no-cycle lint rule in this repo, both functions are hoisted
// `export async function` declarations, and neither module calls the
// other at module-evaluation time (supabaseAdmin() only runs inside
// function bodies). Don't "fix" this by inlining the tag-write logic
// into flows/engine.ts — see the deal_stage_changed dispatch site in
// automations/engine.ts's add_tag step for why keeping this file as
// the single tag-add choke point matters.
import { dispatchEventToFlows } from '@/lib/flows/engine';
import { addContactTagIfAbsent } from './tag-write';
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

export { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from './tag-chain';

interface AddContactTagAndDispatchInput {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  tagId: string;
  context?: AutomationContext;
}

export interface AddContactTagResult {
  added: boolean;
  dispatched: boolean;
  reason?: 'duplicate' | 'max_depth';
}

/**
 * Central server-side tag writer. It dispatches tag_added only for a
 * newly-created join and caps chained tag automations to avoid loops.
 */
export async function addContactTagAndDispatch(
  input: AddContactTagAndDispatchInput
): Promise<AddContactTagResult> {
  const added = await addContactTagIfAbsent(input.db, {
    accountId: input.accountId,
    contactId: input.contactId,
    tagId: input.tagId,
  });

  if (!added) return { added: false, dispatched: false, reason: 'duplicate' };

  const depth = getTagChainDepth(input.context);
  if (depth >= MAX_TAG_CHAIN_DEPTH) {
    console.warn('[automations] tag_added chain depth limit reached', {
      accountId: input.accountId,
      contactId: input.contactId,
      tagId: input.tagId,
      depth,
    });
    return { added: true, dispatched: false, reason: 'max_depth' };
  }

  await runAutomationsForTrigger({
    accountId: input.accountId,
    triggerType: 'tag_added',
    contactId: input.contactId,
    context: {
      ...input.context,
      tag_id: input.tagId,
      vars: {
        ...(input.context?.vars ?? {}),
        _tag_chain_depth: depth + 1,
      },
    },
  });

  // No forced exclusivity with the automations dispatch above — an
  // account may legitimately want both an automation (e.g. tag the
  // contact VIP) AND a flow (e.g. start the VIP welcome conversation)
  // to fire off the same tag. dispatchEventToFlows never throws, but
  // wears a .catch() anyway to match every other dispatch site here.
  await dispatchEventToFlows({
    accountId: input.accountId,
    contactId: input.contactId,
    event: { type: 'tag_added', tag_id: input.tagId },
  }).catch((err) =>
    console.error('[flows] tag_added dispatch failed:', err),
  );

  return { added: true, dispatched: true };
}
