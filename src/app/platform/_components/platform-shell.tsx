'use client';

// ============================================================
// PlatformShell — the /platform app frame: fixed left sidebar +
// content area, mirroring the customer dashboard's own shell
// (src/app/(dashboard)/dashboard-shell.tsx + components/layout/sidebar.tsx)
// so this reads as a real back-office system, not a stack of bare
// pages with a thin top nav.
//
// Deliberately does NOT use useAuth()/AuthProvider — that hook reads
// `profiles` (account_id, account_role, etc.), and a platform-staff
// login has none of that by design (see migration 042 — staff never
// get a tenant account). This shell fetches just the signed-in
// user's email directly, which is all a staff footer needs.
// ============================================================

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Building2,
  LayoutDashboard,
  LogOut,
  PlugZap,
  ScrollText,
  Settings,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/platform', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/platform/accounts', label: 'Contas', icon: Building2 },
  { href: '/platform/integrations', label: 'Integrações', icon: PlugZap },
  { href: '/platform/webhooks', label: 'Logs', icon: ScrollText },
  { href: '/platform/settings', label: 'Configurações', icon: Settings },
];

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <img src="/logo.png" alt="" className="h-7 w-7 rounded-md object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">Plataforma</p>
            <p className="truncate text-[11px] text-muted-foreground">Rocketing</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/platform'
                  ? pathname === '/platform'
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 space-y-2 border-t border-border p-3">
          <Link
            href="/dashboard"
            className="block truncate rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ← Voltar ao CRM
          </Link>
          <div className="flex items-center gap-2 px-3 py-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground" title={email ?? ''}>
                {email ?? '—'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sair"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
