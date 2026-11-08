import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client. Use it where there is no `auth.uid()`
// (webhooks, cron, the automation/flows/AI engines) or where a write has
// to bypass RLS. It skips every row-level policy, so the caller is
// responsible for scoping each query to an account.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
