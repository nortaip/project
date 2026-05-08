import { ReactNode, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from 'lucide-react';
import { Card, EmptyState, Input } from './';

export interface Column<T> {
  /** Unique key — used for sorting state and React key */
  key: string;
  /** Header label (text or component) */
  header: ReactNode;
  /** Cell renderer — receives the row */
  cell: (row: T) => ReactNode;
  /** Width hint, e.g. "120px" or "20%" */
  width?: string;
  /** Make this column sortable. Provide accessor for the sort value. */
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number | null | undefined;
  /** Right-align (numbers etc.) */
  align?: 'left' | 'right' | 'center';
  /** Hide on mobile (defaults to false) */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  /** Function returning the unique row id */
  rowKey: (row: T) => string;
  loading?: boolean;
  /** Optional click handler — clicking the row triggers it */
  onRowClick?: (row: T) => void;
  /** Search bar settings — pass searchKeys to enable */
  searchKeys?: (keyof T | ((row: T) => string))[];
  searchPlaceholder?: string;
  /** Page size for pagination */
  pageSize?: number;
  /** Empty state customization */
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  loading,
  onRowClick,
  searchKeys,
  searchPlaceholder = 'Axtar...',
  pageSize = 25,
  emptyTitle = 'Heç nə tapılmadı',
  emptyDescription,
  emptyAction,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Search
  const searched = useMemo(() => {
    if (!search.trim() || !searchKeys) return data;
    const q = search.toLowerCase().trim();
    return data.filter((row) =>
      searchKeys.some((k) => {
        const v =
          typeof k === 'function' ? k(row) : (row as Record<string, unknown>)[k as string];
        return String(v ?? '').toLowerCase().includes(q);
      }),
    );
  }, [data, search, searchKeys]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return searched;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortAccessor) return searched;
    const accessor = col.sortAccessor;
    return [...searched].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return sortDir === 'asc' ? 1 : -1;
      if (bv == null) return sortDir === 'asc' ? -1 : 1;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [searched, columns, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const sliceStart = (safePage - 1) * pageSize;
  const visible = sorted.slice(sliceStart, sliceStart + pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div>
      {/* Search */}
      {searchKeys && searchKeys.length > 0 && (
        <div className="relative mb-4 max-w-md">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <Input
            hasIcon
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              aria-label="Təmizlə"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* Table card */}
      <Card variant="default" padding="none" className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <span className="inline-block w-9 h-9 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-alt">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      style={{ width: c.width }}
                      className={`px-4 py-3 font-bold text-ink-soft uppercase tracking-wide text-xs ${
                        c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                      } ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                    >
                      {c.sortable && c.sortAccessor ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                        >
                          {c.header}
                          {sortKey === c.key ? (
                            sortDir === 'asc' ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : (
                            <ArrowUpDown size={12} className="opacity-50" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`border-b border-border last:border-0 ${
                      onRowClick ? 'cursor-pointer hover:bg-surface-alt' : ''
                    } transition-colors`}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-3 ${
                          c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                        } ${c.hideOnMobile ? 'hidden md:table-cell' : ''}`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {!loading && sorted.length > pageSize && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {sliceStart + 1}–{Math.min(sliceStart + pageSize, sorted.length)} /{' '}
            {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <PageButton
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              icon={<ChevronLeft size={16} />}
            />
            {generatePageNumbers(safePage, totalPages).map((n, i) =>
              n === '...' ? (
                <span
                  key={`gap-${i}`}
                  className="px-2 text-muted text-sm select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={`min-w-[36px] h-9 px-2 rounded-lg font-bold text-sm transition-colors ${
                    n === safePage
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border border-border text-ink-soft hover:border-brand-300'
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <PageButton
              disabled={safePage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              icon={<ChevronRight size={16} />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function PageButton({
  onClick,
  disabled,
  icon,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-w-[36px] h-9 px-2 rounded-lg bg-white border border-border text-ink-soft hover:border-brand-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
    >
      {icon}
    </button>
  );
}

function generatePageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
