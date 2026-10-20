import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Dashed "add" card that closes a card grid (Novo agente, Nova
 * automação...). Same footprint as the entity cards next to it.
 */
export function AddCard({
  title,
  description,
  onClick,
  disabled,
  className,
}: {
  title: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid h-full min-h-[190px] w-full place-items-center rounded-2xl border-2 border-dashed border-border bg-card/40 p-5 text-center transition-colors hover:border-primary/50 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card/40',
        className,
      )}
    >
      <span className="flex flex-col items-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
          <Plus className="size-5" />
        </span>
        <span className="mt-3 font-display text-[15px] font-bold text-foreground">{title}</span>
        {description ? (
          <span className="mt-1 max-w-[16rem] text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
