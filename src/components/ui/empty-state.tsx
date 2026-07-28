import { cn } from "@/lib/cn";

/**
 * Empty states are the first thing a new signup sees, so they use the serif
 * and get real copy rather than a shrug. Each one names the next action.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      {/* Quiet mark: concentric rings, no stock illustration. */}
      <div aria-hidden className="relative mb-6 size-14">
        <span className="absolute inset-0 rounded-full border border-border-default" />
        <span className="absolute inset-[6px] rounded-full border border-border-default opacity-60" />
        <span className="absolute inset-[12px] rounded-full bg-accent-soft" />
      </div>

      <h2 className="font-serif text-2xl leading-tight">{title}</h2>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Page header used across inbox, knowledge base, settings and analytics. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-xl leading-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-[0.8125rem] text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
