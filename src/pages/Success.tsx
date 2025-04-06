import React from 'react';

const Success = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-green-600">Success!</h1>
        <p className="mt-4 text-lg text-gray-700">Your operation was completed successfully.</p>
        <a href="/services" className="mt-6 inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
          Go to Services
        </a>
      </div>
    </div>
  );
};

export default Success; 