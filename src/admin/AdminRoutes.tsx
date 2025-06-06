import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom"; // useNavigate added here
import ProviderSidebar from "./ProviderSidebar";
import OpportunitiesPage from "./OpportunitiesPage";
import OffersPage from "./OffersPage";
import WonPage from "./WonPage";
import ServicesPage from "./ServicesPage";
import BalancePage from "./BalancePage";
import { supabase } from '../lib/supabase';
import { Spin } from 'antd';
import { ProfilePage } from "./ProfilePage";

const AdminRoutes: React.FC = () => {
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate(); // Initialize useNavigate here

  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const { data, error: userError } = await supabase.auth.getUser();
        const user = data?.user;

        if (userError) {
          console.error('User fetch error:', userError.message);
        }

        if (user) {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

          if (error) {
            console.error('Error fetching user profile:', error.message);
            setUserRole(null);
          } else {
            console.log('Fetched user role:', profile.role);
            setUserRole(profile.role);
          }
        } else {
          console.warn('No user session found. Redirecting...');
          navigate('/login');
        }
      } catch (error) {
        console.error('Error getting user session:', error);
        setUserRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUserRole();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchUserRole();
      } else {
        navigate('/login');
      }
    });

    return () => {
      listener?.subscription?.unsubscribe?.();
    };
  }, [navigate]);


  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Spin size="large" tip="Yüklənir..." />
      </div>
    );
  }

  return (
    <div className="flex bg-gray-50 min-h-screen">
      <ProviderSidebar userRole={userRole} />
      <main className="flex-1 p-6">
        <Routes>
          <Route path="opportunities" element={<OpportunitiesPage/>} />
          <Route path="offers" element={<OffersPage />} />
          <Route path="main" element={<ProfilePage />} />
          <Route path="won" element={<WonPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="balance" element={<BalancePage />} />

          {/* Redirect to a safe default if opportunities is not allowed or for other unmatched routes */}
          <Route
            path="*"
            element={
              userRole
                ? <Navigate to={userRole === 'provider' ? "opportunities" : "offers"} replace />
                : <Spin size="large" tip="Yüklənir..." />
            }
          />

        </Routes>
      </main>
    </div>
  );
};

export default AdminRoutes;