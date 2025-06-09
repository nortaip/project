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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    <div className="flex bg-gray-50 min-h-screen relative">
      {/* Sidebar - hidden on mobile, toggleable */}
      <div className={`fixed z-50 top-0 left-0 h-full bg-white shadow-lg transform transition-transform duration-300 ease-in-out
                     ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
                     lg:translate-x-0 lg:relative lg:block`}>
        <ProviderSidebar userRole={userRole} />
      </div>

      {/* Overlay on mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 p-4 lg:p-6 w-full">
        {/* Mobile navbar with toggle button */}
        <div className="lg:hidden flex items-center justify-between mb-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-600 focus:outline-none"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2"
              viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">Panel</h1>
        </div>

        <Routes>
          <Route path="opportunities" element={<OpportunitiesPage />} />
          <Route path="offers" element={<OffersPage />} />
          <Route path="main" element={<ProfilePage />} />
          <Route path="won" element={<WonPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="balance" element={<BalancePage />} />
          <Route
            path="*"
            element={
              userRole
                ? <Navigate to={userRole === 'provider' ? "opportunities" : "main"} replace />
                : <Spin size="large" tip="Yüklənir..." />
            }
          />
        </Routes>
      </main>
    </div>

  );
};

export default AdminRoutes;