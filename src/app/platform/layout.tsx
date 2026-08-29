import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/platform'
import { PlatformShell } from './_components/platform-shell'

// Server layout — gates the ENTIRE /platform tree on staff status
// before rendering anything. `notFound()` (a genuine 404) rather than
// a 403 page: a 403 confirms the route exists to anyone who's merely
// logged in, which is exactly the kind of thing worth not confirming
// for a staff-only cross-tenant panel.
//
// Session-level access is already gated by middleware.ts
// (protectedPaths includes '/platform'); the actual is_platform_admin()
// check happens here, not in middleware, to avoid a DB round trip on
// every matched request.
//
// The actual app frame (sidebar, header, sign-out) lives in
// PlatformShell (a client component) — kept separate from this file
// so this server component's only job stays the auth gate.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
}

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const isStaff = await isCurrentUserPlatformAdmin()
  if (!isStaff) notFound()

  return <PlatformShell>{children}</PlatformShell>
}
