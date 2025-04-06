import React from 'react';

const Error = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-red-600">Error!</h1>
        <p className="mt-4 text-lg text-gray-700">Something went wrong. Please try again later.</p>
        <a href="/services" className="mt-6 inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
          Go to Services
        </a>
      </div>
    </div>
  );
};

export default Error; 