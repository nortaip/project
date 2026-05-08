import {
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import { twMerge } from 'tailwind-merge';

// ── Field wrapper (label + icon + error) ─────────────────────────

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  icon?: ReactNode;
  rightAdornment?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  error,
  hint,
  required,
  icon,
  rightAdornment,
  children,
  className,
}: FieldProps) {
  return (
    <div className={twMerge('mb-4', className)}>
      {label && (
        <label className="block mb-1.5 text-sm font-bold text-ink-soft">
          {label}
          {required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
            {icon}
          </span>
        )}
        {children}
        {rightAdornment && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            {rightAdornment}
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-1.5 ml-1 text-xs font-semibold text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 ml-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Input (Flutter-style) ────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasIcon?: boolean;
  hasRightAdornment?: boolean;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasIcon, hasRightAdornment, invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={twMerge(
        'w-full py-4 rounded-2xl bg-surface-alt outline-none transition-colors',
        'text-[15px] font-medium text-ink placeholder-muted',
        'border-[1.5px]',
        invalid
          ? 'border-danger focus:border-danger'
          : 'border-border focus:border-brand-600 focus:bg-white',
        hasIcon ? 'pl-12' : 'pl-4',
        hasRightAdornment ? 'pr-12' : 'pr-4',
        className,
      )}
      {...rest}
    />
  );
});

// ── Textarea ──────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={twMerge(
          'w-full px-4 py-3 rounded-2xl bg-surface-alt outline-none transition-colors resize-none',
          'text-[15px] font-medium text-ink placeholder-muted',
          'border-[1.5px]',
          invalid
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-brand-600 focus:bg-white',
          className,
        )}
        {...rest}
      />
    );
  },
);
