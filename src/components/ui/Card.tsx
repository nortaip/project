import { HTMLAttributes, ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-7',
};

const variantClasses = {
  default: 'bg-white rounded-3xl border border-border shadow-card',
  elevated: 'bg-white rounded-3xl border border-border shadow-card-lg',
  flat: 'bg-surface-alt rounded-2xl border border-border',
};

export function Card({
  variant = 'default',
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={twMerge(
        variantClasses[variant],
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
  ...rest
}: CardHeaderProps) {
  return (
    <div
      className={twMerge('flex items-start justify-between mb-4', className)}
      {...rest}
    >
      <div>
        <h3 className="text-lg font-extrabold text-ink tracking-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-sm text-muted font-medium">{subtitle}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
