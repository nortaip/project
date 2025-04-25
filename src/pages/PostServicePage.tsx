import React from 'react';
import { PostServiceForm } from '../components/PostServiceForm';

export function PostServicePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <PostServiceForm
          onClose={() => window.history.back()} // Navigate back on close
          onSubmit={async (serviceData) => {
            // Handle form submission
          }}
        />
      </div>
    </div>
  );
} 