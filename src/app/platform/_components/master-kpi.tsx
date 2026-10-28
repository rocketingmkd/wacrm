import type { ReactNode } from 'react';
import { TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Headline number card of the Master panel; `accent` gives it the red wash. */
export function MasterKpi({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-4 sm:p-5',
        accent
          ? 'border-red-500/30 bg-gradient-to-br from-red-500/15 to-red-500/[0.02]'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-start gap-2 text-[12.5px] leading-tight text-muted-foreground">
        <span className="mt-px shrink-0 text-red-500">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-2 font-display text-2xl font-extrabold tabular-nums sm:text-3xl">{value}</div>
      {hint && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 dm:text-red-300">
          <TrendingUp className="size-3.5" />
          {hint}
        </div>
      )}
    </div>
  );
}
