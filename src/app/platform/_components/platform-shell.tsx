'use client';

// ============================================================
// PlatformShell — the /platform app frame ("Master" back office):
// red-accented sidebar on desktop, top bar + bottom nav on phones.
// Visual identity follows the RocketingZAP Master panel.
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
  ArrowLeft,
  Building2,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  PlugZap,
  ScrollText,
  Settings,
  Shield,
  Sun,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  /** Short label for the phone bottom bar. */
  short?: string;
  icon: typeof LayoutDashboard;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operação',
    items: [
      { href: '/platform', label: 'Painel', icon: LayoutDashboard },
      { href: '/platform/accounts', label: 'Contas', icon: Building2 },
      { href: '/platform/subscriptions', label: 'Assinaturas', short: 'Assinat.', icon: CreditCard },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { href: '/platform/integrations', label: 'Integrações', icon: PlugZap },
      { href: '/platform/webhooks', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    label: 'Administração',
    items: [
      { href: '/platform/accounts/new', label: 'Nova conta', icon: Plus },
      { href: '/platform/settings', label: 'Configurações', short: 'Config.', icon: Settings },
    ],
  },
];

const MOBILE_ITEMS: NavItem[] = [
  NAV_SECTIONS[0].items[0],
  NAV_SECTIONS[0].items[1],
  NAV_SECTIONS[0].items[2],
  NAV_SECTIONS[1].items[1],
  NAV_SECTIONS[2].items[1],
];

/** "Contas" must not light up on /platform/accounts/new, which has its own entry. */
function isActive(pathname: string, href: string): boolean {
  if (href === '/platform') return pathname === '/platform';
  if (href === '/platform/accounts') {
    return pathname.startsWith(href) && !pathname.startsWith('/platform/accounts/new');
  }
  return pathname.startsWith(href);
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, toggleMode } = useTheme();
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

  const userName = (email ?? 'Master').split('@')[0];
  const ThemeIcon = mode === 'dark' ? Sun : Moon;

  const themeButton = (
    <button
      type="button"
      onClick={toggleMode}
      aria-label="Alternar tema"
      title={mode === 'dark' ? 'Tema claro' : 'Tema escuro'}
      className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
    >
      <ThemeIcon className="size-4" />
    </button>
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Master ambient glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 60%)' }}
        />
        <div
          className="absolute -left-40 top-[40%] h-[480px] w-[480px] rounded-full opacity-10 blur-3xl"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 65%)' }}
        />
      </div>

      {/* Phone top bar */}
      <header className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-red-500 to-red-700 text-white">
            <Shield className="size-4" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-none text-red-600 dm:text-red-400">Master</p>
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">Rocketing CRM · admin</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {themeButton}
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sair"
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="relative z-10 hidden h-full w-[250px] shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-5">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-white shadow-md ring-1 ring-border">
            <Shield className="size-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-[16px] font-extrabold tracking-tight text-red-600 dm:text-red-400">
              Master
            </p>
            <p className="-mt-0.5 truncate text-[11.5px] text-muted-foreground">Rocketing CRM · admin</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {section.label}
              </p>
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'relative flex items-center gap-3 rounded-lg px-3 py-[10px] text-[14.5px] font-medium transition-colors',
                          active
                            ? 'bg-red-500/10 text-foreground shadow-[inset_0_0_0_1px_rgba(239,68,68,0.25)]'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {active && (
                          <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-red-500 shadow-[0_0_12px_#ef4444]" />
                        )}
                        <item.icon
                          className={cn('size-[18px] shrink-0', active && 'text-red-600 dm:text-red-400')}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Voltar ao CRM
          </Link>
        </nav>

        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-2 py-2">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-red-500/10 text-[13px] font-bold text-red-600 ring-1 ring-red-500/25 dm:text-red-400">
              {userName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold" title={email ?? ''}>
                {userName}
              </p>
              <p className="truncate text-[11px] text-red-600 dm:text-red-400">Super admin</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sair"
              title="Sair"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-28 pt-4 md:p-8 md:pb-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 hidden items-center justify-between gap-3 md:flex">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[13.5px] font-medium text-red-600 dm:text-red-400">
              <span className="size-1.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
              Modo super admin
            </div>
            {themeButton}
          </div>
          {children}
        </div>
      </main>

      {/* Phone bottom nav */}
      <nav
        aria-label="Navegação do painel"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/90 backdrop-blur-xl md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center gap-1 px-1 py-2.5 text-[10.5px] font-medium',
                    active ? 'text-red-600 dm:text-red-400' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="size-5" />
                  {item.short ?? item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
