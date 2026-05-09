import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import WorkspaceLayout from './WorkspaceLayout';
import OpportunitiesPage from './OpportunitiesPage';
import OffersPage from './OffersPage';
import WonPage from './WonPage';
import ServicesPage from './ServicesPage';
import BalancePage from './BalancePage';

export default function AdminRoutes() {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate('/login');
          return;
        }
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (error) {
          setUserRole(null);
        } else {
          setUserRole(profile.role);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchUserRole();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) fetchUserRole();
      else navigate('/login');
    });

    return () => {
      listener?.subscription?.unsubscribe?.();
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-surface-bg">
        <Loader2 size={28} className="animate-spin text-brand-600" />
      </div>
    );
  }

  // Provider üçün default opportunities, başqa rollar üçün services
  const defaultRoute = userRole === 'provider' ? 'opportunities' : 'services';

  return (
    <WorkspaceLayout userRole={userRole}>
      <Routes>
        <Route path="opportunities" element={<OpportunitiesPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="won" element={<WonPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="balance" element={<BalancePage />} />
        <Route path="*" element={<Navigate to={defaultRoute} replace />} />
      </Routes>
    </WorkspaceLayout>
  );
}
