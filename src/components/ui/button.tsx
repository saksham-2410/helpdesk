import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  // The system voice. One primary action per view.
  primary:
    "bg-accent text-accent-text shadow-low hover:bg-accent-hover active:translate-y-px",
  // Default for most toolbar actions — reads as a real control without
  // competing with the primary.
  secondary:
    "bg-surface text-primary border border-border-default shadow-low hover:bg-paper-100 hover:border-border-strong active:translate-y-px dark:hover:bg-paper-800",
  // For dense rows where a bordered button would add visual debt.
  ghost:
    "text-secondary hover:bg-paper-200/70 hover:text-primary dark:hover:bg-paper-800",
  // Destructive: delete article, remove teammate.
  danger:
    "bg-danger-500 text-white shadow-low hover:bg-danger-700 active:translate-y-px",
  // Tinted, low-commitment affordance — "Generate summary", "Suggest reply".
  subtle:
    "bg-accent-soft text-accent border border-transparent hover:border-accent/25",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[0.8125rem] gap-1.5 rounded-sm",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-[0.9375rem] gap-2 rounded-md",
  icon: "h-8 w-8 rounded-md",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium",
          "transition-[background-color,border-color,color,transform,box-shadow] duration-150",
          "disabled:pointer-events-none disabled:opacity-45",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            aria-hidden
            className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
          />
        )}
        {children}
      </button>
    );
  },
);
