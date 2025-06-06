import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { User, Menu, Bell, Calendar } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface NavbarProps {
  className?: string;
}

export const Navbar = ({ className = '' }: NavbarProps) => {
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <nav className={`${className} py-4 bg-white shadow-sm`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <Link to="/" className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-indigo-600">Ellit.az</span>
            </Link>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link to="/services" className="text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-gray-300">
                {t('nav.services')}
              </Link>
              <Link to="/providers" className="text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-gray-300">
                {t('nav.providers')}
              </Link>
              <Link to="/about" className="text-gray-900 inline-flex items-center px-1 pt-1 border-b-2 border-transparent hover:border-gray-300">
                {t('nav.about')}
              </Link>
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex items-center">

              {user ? (
                <>
                  {/* <Link
                    to="/post-service"
                    className="ml-6 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    Servis paylaş
                  </Link> */}
                  {/* <Link to="/bookings" className="ml-6 p-1 rounded-full text-gray-400 hover:text-gray-500">
                    <Calendar className="h-6 w-6" />
                  </Link> */}
                  <Link to="/profile" className="ml-6 p-1 rounded-full text-gray-400 hover:text-gray-500">
                    <User className="h-6 w-6" />
                  </Link>
                </>
              ) : (
                <div className="ml-6 flex items-center space-x-4">
                  <Link to="/login" className="text-gray-900 hover:text-gray-700">
                    {t('nav.login')}
                  </Link>
                  <Link
                    to="/signup"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700"
                  >
                    {t('nav.signup')}
                  </Link>
                </div>
              )}
              <div className="ml-6 -mr-2 flex items-center sm:hidden">
                <button
                  className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu className="h-6 w-6" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Sidebar for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black opacity-30" onClick={() => setSidebarOpen(false)}></div>
          <div className="relative bg-white w-64 h-full shadow-lg z-50">
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
            <nav className="mt-16 flex flex-col space-y-4 px-6">
              <Link to="/services" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                {t('nav.services')}
              </Link>
              <Link to="/providers" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                {t('nav.providers')}
              </Link>
              <Link to="/about" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                {t('nav.about')}
              </Link>
              {user ? (
                <>
                  <Link to="/bookings" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                    {t('nav.bookings')}
                  </Link>
                  <Link to="/profile" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                    {t('nav.profile')}
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/login" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
                    {t('nav.login')}
                  </Link>
                  <Link to="/signup" className="text-gray-900" onClick={() => setSidebarOpen(false)}>
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