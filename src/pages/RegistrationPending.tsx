import React from 'react';
import { Link } from 'react-router-dom';
import { Mail, RefreshCw } from 'lucide-react';

export function RegistrationPending() {
  const email = localStorage.getItem('pendingRegistrationEmail') || '';
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <Mail className="mx-auto h-12 w-12 text-indigo-600" />
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Check Your Email
          </h2>
          <p className="mt-2 text-center text-md text-gray-600">
            We've sent an email to <strong>{email}</strong> with instructions to complete your registration.
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-left">
            <p className="text-sm text-blue-700">
              <RefreshCw className="inline h-4 w-4 mr-2" />
              If you don't see the email in your inbox, please check your spam folder.
            </p>
          </div>
          
          <div className="flex flex-col space-y-4">
            <Link
              to="/login"
              className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
            >
              Go to Login
            </Link>
            
            <Link
              to="/signup"
              className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Back to Sign Up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
} 