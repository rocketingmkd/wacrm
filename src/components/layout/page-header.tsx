import type { ComponentType, ReactNode } from 'react';

/**
 * Centered page header used by the list pages (Automações, Fluxos,
 * Disparos): an icon tile, the title, a short description and the page
 * actions underneath.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  badge,
  actions,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  /** Small chip next to the title (e.g. "Beta"). */
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="text-center">
      <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="size-6" />
      </span>
      <div className="flex items-center justify-center gap-2">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
          {title}
        </h1>
        {badge}
      </div>
      {description ? (
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      ) : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
