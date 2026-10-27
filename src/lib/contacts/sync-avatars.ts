import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchProfilePictureUrl } from '@/lib/whatsapp/evolution-api'

const BUCKET = 'contact-avatars'
const MAX_BYTES = 1024 * 1024
/** A contact with no photo is asked again after this long. */
const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

export interface SyncedAvatar {
  contact_id: string
  avatar_url: string
}

interface ContactRow {
  id: string
  phone: string | null
  is_group: boolean
  group_jid: string | null
}

async function downloadImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) return null
  const type = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return null
  const bytes = await res.arrayBuffer()
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES ? { bytes, type } : null
}

/**
 * Fetch WhatsApp profile photos for up to `limit` contacts of the account
 * that have none yet, copy them to storage and save the public URL.
 * Contacts are stamped `avatar_checked_at` whether or not a photo was
 * found, so no-photo contacts are not retried on every Inbox load.
 * Only touches `avatar_url` / `avatar_checked_at` of the selected rows.
 */
export async function syncContactAvatars(
  db: SupabaseClient,
  args: { accountId: string; instanceName: string; limit: number },
): Promise<SyncedAvatar[]> {
  const staleBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString()
  const { data: contacts } = await db
    .from('contacts')
    .select('id, phone, is_group, group_jid')
    .eq('account_id', args.accountId)
    .is('avatar_url', null)
    .or(`avatar_checked_at.is.null,avatar_checked_at.lt.${staleBefore}`)
    .order('updated_at', { ascending: false })
    .limit(args.limit)
    .returns<ContactRow[]>()

  const synced: SyncedAvatar[] = []
  for (const contact of contacts ?? []) {
    const number = contact.is_group ? contact.group_jid : contact.phone?.replace(/\D/g, '')
    let avatarUrl: string | null = null

    if (number) {
      try {
        const remote = await fetchProfilePictureUrl({ instanceName: args.instanceName, number })
        const image = remote ? await downloadImage(remote) : null
        if (image) {
          const path = `${args.accountId}/${contact.id}.jpg`
          const { error } = await db.storage
            .from(BUCKET)
            .upload(path, image.bytes, { contentType: image.type, upsert: true })
          if (!error) {
            // Timestamp busts the CDN/browser cache if the photo changes later.
            avatarUrl = `${db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
          }
        }
      } catch (err) {
        console.warn('[avatars] sync failed for contact', contact.id, err instanceof Error ? err.message : err)
      }
    }

    await db
      .from('contacts')
      .update({ avatar_checked_at: new Date().toISOString(), ...(avatarUrl ? { avatar_url: avatarUrl } : {}) })
      .eq('id', contact.id)
      .eq('account_id', args.accountId)
    if (avatarUrl) synced.push({ contact_id: contact.id, avatar_url: avatarUrl })
  }
  return synced
}
