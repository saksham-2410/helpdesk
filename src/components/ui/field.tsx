import * as React from "react";
import { cn } from "@/lib/cn";

const CONTROL = cn(
  "w-full rounded-md border border-border-default bg-surface px-3 text-sm text-primary",
  "placeholder:text-muted",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-border-strong",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-danger-500 aria-[invalid=true]:ring-danger-500/20",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...props} />;
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, "min-h-20 resize-y py-2 leading-relaxed", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(CONTROL, "h-9 cursor-pointer appearance-none pr-8", className)}
      {...props}
    />
  );
});

/**
 * Label + control + error/hint wrapper. Wires up htmlFor/id and aria-describedby
 * so every form in the app is accessible without per-form effort.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[0.8125rem] font-medium text-secondary">
        {label}
        {required && <span className="ml-0.5 text-signal-500">*</span>}
      </label>

      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": describedBy,
          })
        : children}

      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger-500">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
