import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isCurrentUserPlatformAdmin } from '@/lib/auth/platform'

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Plataforma Rocketing
            </p>
            <p className="text-xs text-muted-foreground">
              Painel interno — gestão de contas e cobrança
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/platform/accounts" className="text-muted-foreground hover:text-foreground">
              Contas
            </Link>
            <Link href="/platform/webhooks" className="text-muted-foreground hover:text-foreground">
              Webhooks
            </Link>
            <Link href="/platform/settings" className="text-muted-foreground hover:text-foreground">
              Configurações
            </Link>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
              Voltar ao CRM
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}
