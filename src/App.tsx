import React, { useState, useEffect } from 'react';
import {
  Route,
  Outlet,
  BrowserRouter,
  Routes
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
// Add this import for the admin bookings page
import { AdminBookings } from './pages/AdminBookings';
import { ProviderProfile } from './pages/ProviderProfile';
import { PaymentHistory } from './pages/PaymentHistory';
import UpdateBalance from './pages/UpdateBalance';
import { About } from './pages/About';
import { Privacy } from './pages/Privacy';
import Success from './pages/Success';
import Error from './pages/Error';
import Result from './pages/Result';
import { PostServicePage } from './pages/PostServicePage';
import { supabase } from './lib/supabase';
import { CompleteProfile } from './pages/CompleteProfile';
import { RegistrationPending } from './pages/RegistrationPending';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import EditService from './pages/EditService';

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

// Add interface for AdBanner
interface AdBanner {
  id: string;
  side: 'left' | 'right';
  image_url: string;
  href?: string;
  is_active: boolean;
}

// Update Layout component
const Layout = () => {
  const [adBanners, setAdBanners] = useState<AdBanner[]>([]);

  useEffect(() => {
    fetchAdBanners();
  }, []);

  const fetchAdBanners = async () => {
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      setAdBanners(data || []);
    } catch (error) {
      console.error('Error fetching ad banners:', error);
    }
  };

  const getAdBanner = (side: 'left' | 'right') => {
    return adBanners.find(banner => banner.side === side);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Render AdBanners outside the margin container */}
      <AdBanner
        side="left"
        imageUrl={getAdBanner('left')?.image_url}
        href={getAdBanner('left')?.href}
      />
      <AdBanner
        side="right"
        imageUrl={getAdBanner('right')?.image_url}
        href={getAdBanner('right')?.href}
      />
      {/* Main content container with margins */}
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

// Update AdBanner component to handle href
interface AdBannerProps {
  side: 'left' | 'right';
  imageUrl?: string;
  href?: string;
}

const AdBanner = ({ side, imageUrl, href }: AdBannerProps) => {
  const id = side === 'left' ? 'ar_left_12327773' : 'ar_right_12327773';
  const iframeId = side === 'left' ? '_iframe_1232777361975' : '_iframe_12327773323246';

  const handleClick = () => {
    if (href) {
      window.open(href, '_blank');
    }
  };

  return (
    <div
      style={{
        zIndex: 65000,
        position: 'fixed',
        [side]: 0,
        top: 0,
        height: '100vh',
        cursor: href ? 'pointer' : 'default',
        backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundColor: '#f0f0f0'
      }}
      id={id}
      className={`lotriver-bg-${side} hidden lg:block 
        w-[100px] xl:w-[180px] 2xl:w-[250px]`}
      onClick={handleClick}
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

interface Announcement {
  id: string;
  title: string;
  content: string;
  image_url?: string;
  gif_url?: string;
  href?: string;
  type: 'info' | 'warning' | 'success' | 'error';
}

export function App() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<string[]>([]);

  useEffect(() => {
    fetchAnnouncements();
    // Load dismissed announcements from localStorage
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
    setDismissedAnnouncements(dismissed);
  }, []);

  const fetchAnnouncements = async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .gte('end_date', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching announcements:', error);
      return;
    }

    setAnnouncements(data || []);
  };

  useEffect(() => {
    // Inject Google Analytics script
    const script1 = document.createElement('script');
    script1.async = true;
    script1.src = 'https://www.googletagmanager.com/gtag/js?id=G-Z9KH2ZPECF';
    document.head.appendChild(script1);

    const script2 = document.createElement('script');
    script2.innerHTML = `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-Z9KH2ZPECF');
    `;
    document.head.appendChild(script2);

    // Cleanup scripts on unmount
    return () => {
      document.head.removeChild(script1);
      document.head.removeChild(script2);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />} errorElement={<ErrorBoundary />}>
          <Route path="/" element={<RandomUsers />} />
          <Route path="/services" element={<Services />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/Resetpassword/:email" element={<ResetPassword />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/provider/:id" element={<ProviderProfile />} />
          <Route path="/book/:serviceId" element={<BookService />} />
          <Route path="/bookings/confirmation" element={<BookingConfirmation />} />
          <Route path="/bookings" element={<Bookings />} />
          {/* Add this line for the admin bookings page */}
          <Route path="/SMR/admin" element={<AdminBookings />} />
          <Route path="/edit-service/:serviceId" element={<EditService />} />
          <Route path="/update-balance" element={<UpdateBalance />} />
          <Route path="/payment-history" element={<PaymentHistory />} />
          <Route path="/payment/success" element={<Success />} />
          <Route path="/payment/error" element={<Error />} />
          <Route path="/payment/result" element={<Result />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/post-service" element={<PostServicePage />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/registration-pending" element={<RegistrationPending />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
