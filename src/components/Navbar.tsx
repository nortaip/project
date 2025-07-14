import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { User, Menu, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';

interface NavbarProps {
  className?: string;
}

export const Navbar = ({ className = '' }: NavbarProps) => {
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  // Provider rolunu və balansı Supabase-dən çək
  useEffect(() => {
    const fetchProfile = async () => {
      if (user?.id) {
        const { data, error } = await supabase
          .from('profiles')
          .select('role, balance')
          .eq('id', user.id)
          .single();
        setUserRole(data?.role || null);
        setBalance(data?.balance ?? null);
      } else {
        setUserRole(null);
        setBalance(null);
      }
    };
    fetchProfile();
  }, [user?.id]);

  // Balans komponenti
  const BalanceChip = () =>
    (user && balance !== null) ? (
      <span className="
        inline-flex items-center px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-pink-500
        text-white rounded-full font-semibold text-sm shadow hover:scale-105 transition-all
        select-none
      ">
        <span className="mr-1">{t('nav.balance', 'Balans')}:</span>
        <span className="font-bold">{balance.toLocaleString()} ₼</span>
      </span>
    ) : null;

  return (
    <nav className={`${className} py-4 bg-white shadow-sm relative z-50`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <Link to="/" className="flex-shrink-0 flex items-center">
              <span className="text-2xl font-bold text-indigo-600">Ellit.az</span>
            </Link>
            <div className="hidden sm:ml-10 sm:flex sm:space-x-8">
              <Link to="/services" className="text-gray-700 hover:text-indigo-600 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-500 transition-colors duration-200 text-base font-medium">
                {t('nav.services')}
              </Link>
              <Link to="/providers" className="text-gray-700 hover:text-indigo-600 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-500 transition-colors duration-200 text-base font-medium">
                {t('nav.providers')}
              </Link>
              <Link to="/about" className="text-gray-700 hover:text-indigo-600 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-indigo-500 transition-colors duration-200 text-base font-medium">
                {t('nav.about')}
              </Link>
            </div>
          </div>

          {/* User actions / Auth buttons */}
          <div className="flex items-center space-x-4">
            {/* Desktopda balans göstəricisi */}
            <div className="hidden sm:block">{user && <BalanceChip />}</div>

            <div className="hidden sm:flex items-center space-x-2">
              {user ? (
                <>
                  {userRole === "provider" && (
                    <Link
                      to="/profile/opportunities"
                      className="
                        flex items-center gap-2 px-5 py-2.5
                        bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-600
                        text-white font-bold rounded-full shadow-lg relative overflow-hidden group
                        transition-all duration-500 ease-in-out
                        hover:scale-105 hover:shadow-xl hover:from-purple-600 hover:to-yellow-400
                      "
                      style={{
                        boxShadow: "0 4px 16px 0 rgba(189,24,255,0.18)",
                        animation: "pulse-shadow 2s infinite cubic-bezier(0.4, 0, 0.6, 1)"
                      }}
                    >
                      <style>
                        {`
                          @keyframes pulse-shadow {
                            0%, 100% {
                              box-shadow: 0 4px 16px 0 rgba(189,24,255,0.18);
                              border-color: transparent;
                            }
                            50% {
                              box-shadow: 0 8px 32px 0 rgba(189,24,255,0.4);
                              border-color: #8B5CF6;
                            }
                          }
                        `}
                      </style>
                      <span className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-300 rounded-full blur-md"></span>
                      <Zap className="h-5 w-5 mr-2 animate-bounce-slow" />
                      <span>Fürsətlərə Bax</span>
                    </Link>
                  )}
                  <Link to="/profile" className="p-1 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                    <User className="h-6 w-6" />
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/login" className="px-4 py-2 text-gray-700 hover:text-indigo-600 font-medium transition-colors">
                    {t('nav.login')}
                  </Link>
                  <Link
                    to="/signup"
                    className="inline-flex items-center px-5 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition-colors duration-200"
                  >
                    {t('nav.signup')}
                  </Link>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="-mr-2 flex items-center sm:hidden">
              <button
                type="button"
                className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                onClick={() => setSidebarOpen(true)}
              >
                <span className="sr-only">Open main menu</span>
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar (Drawer) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => setSidebarOpen(false)}></div>

          {/* Sidebar content */}
          <div className="relative bg-white w-64 max-w-xs h-full shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col">
            <div className="px-5 pt-4 pb-2 relative">
              <button
                className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
                onClick={() => setSidebarOpen(false)}
              >
                <span className="sr-only">Close menu</span>
                <X className="h-6 w-6" />
              </button>
              {/* Logo in sidebar */}
              <Link to="/" className="flex items-center mb-6" onClick={() => setSidebarOpen(false)}>
                <span className="text-2xl font-bold text-indigo-600">Ellit.az</span>
              </Link>
              {/* Mobil balans göstəricisi */}
              {user && balance !== null && (
                <div className="mb-4 flex justify-start">
                  <BalanceChip />
                </div>
              )}
            </div>
            <nav className="flex flex-col space-y-2 px-4 pb-4 flex-1">
              <Link to="/services" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                {t('nav.services')}
              </Link>
              <Link to="/providers" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                {t('nav.providers')}
              </Link>
              <Link to="/about" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                {t('nav.about')}
              </Link>
              {user ? (
                <>
                  {userRole === "provider" && (
                    <Link
                      to="/profile/opportunities"
                      className="
                        flex items-center gap-2 justify-center
                        my-2 px-4 py-2
                        bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-600
                        text-white font-bold rounded-full shadow-lg animate-pulse
                        hover:scale-105 transition-all duration-300
                      "
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Zap className="h-5 w-5 animate-bounce mr-1" />
                      <span>Fürsətlərə Bax</span>
                    </Link>
                  )}

                  <Link to="/profile" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                    {t('nav.profile', 'Profil')}
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/login" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                    {t('nav.login')}
                  </Link>
                  <Link to="/signup" className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-100" onClick={() => setSidebarOpen(false)}>
                    {t('nav.signup')}
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      )}
    </nav>
  );
};
