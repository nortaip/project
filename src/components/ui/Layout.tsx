import { HTMLAttributes, ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

// ── Page container with consistent max-width + padding ────────────

interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const sizeClasses = {
  sm: 'max-w-xl',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
  xl: 'max-w-7xl',
  full: 'max-w-none',
};

export function PageContainer({
  size = 'lg',
  className,
  children,
  ...rest
}: PageContainerProps) {
  return (
    <div
      className={twMerge(
        'mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 lg:py-10',
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

// ── Section header (for inside a page) ───────────────────────────

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={twMerge(
        'flex items-end justify-between mb-5 gap-3',
        className,
      )}
    >
      <div>
        <h2 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm text-muted font-medium">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

// ── Stat tile (for dashboards) ───────────────────────────────────

interface StatTileProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { value: number; positive?: boolean };
  className?: string;
}

export function StatTile({
  label,
  value,
  icon,
  trend,
  className,
}: StatTileProps) {
  return (
    <div
      className={twMerge(
        'bg-white rounded-2xl border border-border p-4 sm:p-5 shadow-card',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs sm:text-sm font-bold text-muted uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <span className="text-brand-600 bg-brand-50 rounded-xl w-9 h-9 flex items-center justify-center">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight">
          {value}
        </span>
        {trend && (
          <span
            className={twMerge(
              'text-xs font-bold',
              trend.positive ? 'text-success' : 'text-danger',
            )}
          >
            {trend.positive ? '+' : ''}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={twMerge(
        'flex flex-col items-center text-center py-12 px-6',
        className,
      )}
    >
      {icon && (
        <div className="mb-4 w-16 h-16 rounded-2xl bg-surface-alt border border-border flex items-center justify-center text-muted">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-extrabold text-ink">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
