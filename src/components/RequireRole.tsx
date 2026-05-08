import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface Props {
  /** Allowed role(s). User must have one of these `profiles.role` values. */
  role: string | string[];
  /** Where to send unauthorized users. Default `/login`. */
  redirectTo?: string;
  /** What to render. */
  children: ReactNode;
}

type State =
  | { status: 'loading' }
  | { status: 'unauthorized' }
  | { status: 'allowed' };

/**
 * Route guard that requires the current user's `profiles.role` to match
 * one of the allowed roles. Renders a loading state while checking, then
 * either the children or a redirect.
 *
 * NOTE: This is a client-side gate that prevents UI exposure. **Server-side
 * RLS policies are still the source of truth** — never trust this alone for
 * authorization on data writes. Use it only to hide admin UI from non-admins.
 */
export function RequireRole({ role, redirectTo = '/login', children }: Props) {
  const location = useLocation();
  const [state, setState] = useState<State>({ status: 'loading' });
  const allowed = Array.isArray(role) ? role : [role];

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setState({ status: 'unauthorized' });
          return;
        }
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (error || !profile) {
          if (!cancelled) setState({ status: 'unauthorized' });
          return;
        }
        const userRole = String(profile.role ?? '').toLowerCase();
        const ok = allowed.map((r) => r.toLowerCase()).includes(userRole);
        if (!cancelled) {
          setState({ status: ok ? 'allowed' : 'unauthorized' });
        }
      } catch {
        if (!cancelled) setState({ status: 'unauthorized' });
      }
    };
    check();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-alt">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-8 h-8 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-muted">Yoxlanılır...</span>
        </div>
      </div>
    );
  }

  if (state.status === 'unauthorized') {
    return <Navigate to={redirectTo} replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
