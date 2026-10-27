-- ============================================================
-- 076_contact_avatars.sql
--
-- WhatsApp profile photos for the Inbox. Photos are fetched through the
-- account's Evolution session and COPIED into the public `contact-avatars`
-- bucket (WhatsApp's own URLs expire after a few days).
--
-- contacts.avatar_checked_at: last time we asked WhatsApp for the photo,
-- so contacts without one (or with a private one) are not retried on
-- every Inbox load.
--
-- Writes to the bucket come from the server (service role) only, so no
-- INSERT/UPDATE policy is created. Path: {account_id}/{contact_id}.jpg
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avatar_checked_at timestamptz;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-avatars',
  'contact-avatars',
  TRUE,
  1048576, -- 1 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Contact avatars are publicly readable" ON storage.objects;
CREATE POLICY "Contact avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contact-avatars');
