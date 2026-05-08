import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm rounded-xl',
  md: 'h-11 px-5 text-[14.5px] rounded-2xl',
  lg: 'h-13 px-6 text-[15px] rounded-2xl',
};

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-gradient text-white shadow-brand active:scale-[0.98] hover:shadow-brand-soft disabled:opacity-60',
  secondary:
    'bg-brand-50 text-brand-700 border border-brand-100 hover:bg-brand-100',
  ghost:
    'bg-transparent text-ink hover:bg-surface-alt',
  danger:
    'bg-danger text-white hover:bg-red-700 active:scale-[0.98]',
  dark:
    'bg-black text-white border border-black hover:bg-[#0A0A0A]',
  outline:
    'bg-white text-ink border-[1.5px] border-border hover:bg-surface-alt',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={twMerge(
        'inline-flex items-center justify-center gap-2 font-extrabold tracking-wide transition-all',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        sizeClasses[size],
        variantClasses[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!loading && rightIcon}
    </button>
  );
});
