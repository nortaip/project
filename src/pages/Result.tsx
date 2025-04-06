import React from 'react';

const Result = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-blue-600">Result</h1>
        <p className="mt-4 text-lg text-gray-700">Here are the results of your operation.</p>
        <a href="/services" className="mt-6 inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Go to Services
        </a>
      </div>
    </div>
  );
};

export default Result; 