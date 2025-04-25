import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { Search, User, Menu, Bell, Calendar } from 'lucide-react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useTranslation } from 'react-i18next';

interface NavbarProps {
  className?: string;
}

export const Navbar = ({ className = '' }: NavbarProps) => {
  const user = useAuthStore((state) => state.user);
  const { t } = useTranslation();

  return (
    <nav className={`${className} py-4 bg-white shadow-sm`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <Link to="/" className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-indigo-600">ServiceHub</span>
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
            {user ? (
              <>
                <Link to="/bookings" className="ml-6 p-1 rounded-full text-gray-400 hover:text-gray-500">
                  <Calendar className="h-6 w-6" />
                </Link>
                <button className="ml-6 p-1 rounded-full text-gray-400 hover:text-gray-500">
                  <Bell className="h-6 w-6" />
                </button>
                <div className="ml-3 relative">
                  <Link to="/profile">
                    <User className="h-8 w-8 rounded-full bg-gray-100 p-1" />
                  </Link>
                </div>
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
              <button className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100">
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};