import type { PostgrestError } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export interface PgErrorMapping {
  /** Tag for the console.error line written when the code isn't mapped. */
  label: string
  /** Message returned with a 500 for a code that isn't in `statuses`. */
  fallbackMessage: string
  /**
   * SQLSTATE code to HTTP status. The RPCs raise these on purpose with a
   * message meant for the user, so the Postgres message is returned as is.
   */
  statuses: Record<string, number>
}

/**
 * Turn the error of a Supabase RPC into the dashboard's `{ error: string }`
 * response. Mapped codes pass their message through; anything else is
 * logged and answered with a generic 500 so internals don't leak.
 */
export function pgErrorToResponse(err: PostgrestError, mapping: PgErrorMapping): NextResponse {
  const status = mapping.statuses[err.code]
  if (status !== undefined) {
    return NextResponse.json({ error: err.message }, { status })
  }
  console.error(`[${mapping.label}] unexpected RPC error:`, err)
  return NextResponse.json({ error: mapping.fallbackMessage }, { status: 500 })
}
