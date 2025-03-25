import React from 'react';
import {
  Route,
  createRoutesFromElements,
  createBrowserRouter,
  RouterProvider,
  Outlet
} from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { RandomUsers } from './components/RandomUsers';
import { Services } from './pages/Services';
import { Providers } from './pages/Providers';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Profile } from './pages/Profile';
import { BookService } from './pages/BookService';
import { BookingConfirmation } from './pages/BookingConfirmation';
import { Bookings } from './pages/Bookings';
import { ProviderProfile } from './pages/ProviderProfile';
import { UpdateBalance } from './pages/UpdateBalance';
import { PaymentHistory } from './pages/PaymentHistory';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { PaymentError } from './pages/PaymentError';

// Error boundary component
const ErrorBoundary = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-grow flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Oops! Something went wrong</h2>
          <p className="text-gray-600 mb-4">We're having trouble loading the page</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Try Again
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
};

// Layout component to wrap all routes
const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
     
      <Navbar />
      <main className="flex-grow">
         <Outlet />
      </main>
      <Footer />
    </div>
  );
};

// Create a router with future flags
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route 
      element={<Layout />} 
      errorElement={<ErrorBoundary />}
    >
      <Route 
        path="/" 
        element={<RandomUsers />}
        loader={async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
          return null;
        }}
      />
      <Route path="/services" element={<Services />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/about" element={<div>About Page</div>} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/provider/:id" element={<ProviderProfile />} />
      <Route path="/book/:serviceId" element={<BookService />} />
      <Route path="/bookings/confirmation" element={<BookingConfirmation />} />
      <Route path="/bookings" element={<Bookings />} />
      <Route path="/update-balance" element={<UpdateBalance />} />
      <Route path="/payment-history" element={<PaymentHistory />} />
      <Route path="/payment/success" element={<PaymentSuccess />} />
      <Route path="/payment/error" element={<PaymentError />} />
    </Route>
  ),
  {
    future: {
      v7_relativeSplatPath: true
    }
  }
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;