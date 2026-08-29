'use client';

// ============================================================
// BillingBanner — thin, non-dismissible status bar shown above the
// dashboard's <main> when the account's billing state needs the
// customer's attention. Cosmetic only (server-side RLS is the real
// gate — see supabase/migrations/041_platform_billing.sql); this is
// what tells the customer WHY buttons started disabling.
//
// Deliberately a slim single-row bar, not a modal/popup that opens
// itself — billing status is persistent context, not a one-off nudge,
// so it stays visible for as long as it's true rather than being
// dismissible (a "payment failed" state shouldn't be swipe-away-able).
// ============================================================

import { AlertTriangle, Clock, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

function pluralDays(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`;
}

export function BillingBanner() {
  const { billingWarning } = useAuth();
  if (!billingWarning) return null;

  const { kind, days } = billingWarning;

  const config = {
    trial_ending: {
      icon: Clock,
      tone: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
      message:
        days !== undefined
          ? `Seu período de teste termina em ${pluralDays(days)}. Assine um plano para não perder o acesso.`
          : 'Seu período de teste está acabando. Assine um plano para não perder o acesso.',
    },
    past_due: {
      icon: AlertTriangle,
      tone: 'border-orange-500/30 bg-orange-500/10 text-orange-800 dark:text-orange-300',
      message:
        'Não conseguimos confirmar seu último pagamento. Regularize para evitar a suspensão da conta.',
    },
    locked: {
      icon: Lock,
      tone: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-300',
      message:
        'Sua conta está em modo somente leitura — trial encerrado ou assinatura vencida. Você ainda pode ver seu histórico, mas não enviar mensagens nem editar. Entre em contato para reativar.',
    },
  } as const;

  const { icon: Icon, tone, message } = config[kind];

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-sm',
        tone,
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="leading-snug">{message}</span>
    </div>
  );
}
