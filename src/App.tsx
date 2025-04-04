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
import { About } from './pages/About';
import { Privacy } from './pages/Privacy';

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
// First, let's add the type for services
interface Service {
  id: string;
  title: string;
  description?: string;
  category: string;
  location?: string;
  price: number;
  rating: number;
  images?: string[];
  provider: {
    name: string;
    avatar_url: string;
  };
}

interface AdBannerProps {
  side: 'left' | 'right';
  imageUrl?: string;
}

const AdBanner = ({ side, imageUrl }: AdBannerProps) => {
  const id = side === 'left' ? 'ar_left_12327773' : 'ar_right_12327773';
  const iframeId = side === 'left' ? '_iframe_1232777361975' : '_iframe_12327773323246';

  return (
    <div
      style={{
        zIndex: 65000,
        position: 'fixed',
        [side]: 0,
        top: 0,
        height: '100vh',
        cursor: 'pointer',
        backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#f0f0f0'
      }}
      id={id}
      className={`lotriver-bg-${side} hidden lg:block 
        w-[100px] xl:w-[180px] 2xl:w-[250px]`}
    >
      {!imageUrl && (
        <iframe
          id={iframeId}
          name={iframeId}
          src="about:blank"
          width="100%"
          height="100%"
        />
      )}
    </div>
  );
};
// Layout component to wrap all routes
const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AdBanner 
        side="left" 
        imageUrl="https://i.pinimg.com/736x/a6/dc/fb/a6dcfb123865f263bd33360a339a0925.jpg"
      />
      <AdBanner 
        side="right" 
        imageUrl="https://i.pinimg.com/736x/a6/dc/fb/a6dcfb123865f263bd33360a339a0925.jpg"
      />
      <div className="lg:mx-[110px] xl:mx-[190px] 2xl:mx-[260px]">
        <Navbar className="sticky top-0 z-50 bg-white shadow-sm" />
        <main className="flex-grow min-h-[calc(100vh-136px)]">
          <Outlet />
        </main>
        <Footer className="bg-gray-900 text-gray-300" />
      </div>
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
      <Route path="/about" element={<About />} />
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
      <Route path="/privacy" element={<Privacy />} />
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