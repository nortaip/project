import React, { useState, useEffect } from 'react';
import {
  Route,
  Outlet,
  BrowserRouter,
  Routes
} from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { Providers } from './pages/Providers';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { BookService } from './pages/BookService';
import { BookingConfirmation } from './pages/BookingConfirmation';
import { Bookings } from './pages/Bookings';
// Add this import for the admin bookings page
import { ProviderProfile } from './pages/ProviderProfile';
import { PaymentHistory } from './pages/PaymentHistory';
import UpdateBalance from './pages/UpdateBalance';
import { About } from './pages/About';
import { Privacy } from './pages/Privacy';
import Error from './pages/Error';
import Result from './pages/Result';
import { PostServicePage } from './pages/PostServicePage';
import { supabase } from './lib/supabase';
import { CompleteProfile } from './pages/CompleteProfile';
import { RegistrationPending } from './pages/RegistrationPending';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import EditService from './pages/EditService';
import { MyBookings } from './pages/MyBookings';
import { AdBanner } from './components/AdBanner';
import AdminRoutes from './admin/AdminRoutes';
import DynamicServiceForm from './pages/DynamicServiceForm';
import { RandomUsers } from './components/RandomUsers';
import AdminPanel from './MasterAdmin/main';
import PaymentSuccess from './components/PaymentSuccess';

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
interface AdBannerType {
  id: string;
  side: 'left' | 'right';
  image_url: string;
  href?: string;
  is_active: boolean;
}


// Update Layout component
const Layout = () => {
  const [adBanners, setAdBanners] = useState<AdBannerType[]>([]);

  useEffect(() => {
    async function fetchBanners() {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .eq("is_active", true);

      if (error) {
        setAdBanners([]);
      } else {
        setAdBanners(data || []);
      }
    }
    fetchBanners();
  }, []);

  const leftBanner = adBanners.find(b => b.side === "left" && b.is_active);
  const rightBanner = adBanners.find(b => b.side === "right" && b.is_active);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed'
    }}>
      {/* Left Ad Banner - hidden on screens smaller than lg */}
      <div className="hidden lg:block fixed left-0 top-0 h-full z-40">
        <AdBanner side="left" imageUrl={leftBanner?.image_url} href={leftBanner?.href} />
      </div>

      {/* Right Ad Banner - hidden on screens smaller than lg */}
      <div className="hidden lg:block fixed right-0 top-0 h-full z-40">
        <AdBanner side="right" imageUrl={rightBanner?.image_url} href={rightBanner?.href} />
      </div>

      {/* Main content container with margins */}
      <div className="mx-0 lg:mx-[110px] xl:mx-[190px] 2xl:mx-[260px]">
        <Navbar className="sticky top-0 z-50 bg-white shadow-sm" />
        <main className="flex-grow min-h-[calc(100vh-136px)]">
          <Outlet />
        </main>
        <Footer className="bg-gray-900 text-gray-300" />
      </div>
    </div>
  );
};

export function App() {

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
          <Route path="/services" element={<DynamicServiceForm />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/Resetpassword/:email" element={<ResetPassword />} />
          <Route path="/about" element={<About />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          {/* <Route path="/profile" element={<Profile />} /> */}
          <Route path="/provider/:id" element={<ProviderProfile />} />
          <Route path="/book/:serviceId" element={<BookService />} />
          <Route path="/bookings/confirmation" element={<BookingConfirmation />} />
          <Route path="/Mybookings" element={<MyBookings />} />
          <Route path="/bookings" element={<Bookings />} />
          {/* Add this line for the admin bookings page */}
          <Route path="/edit-service/:serviceId" element={<EditService />} />
          <Route path="/update-balance" element={<UpdateBalance />} />
          <Route path="/payment-history" element={<PaymentHistory />} />
          <Route path="/payment/Success" element={<PaymentSuccess />} />
          <Route path="/error" element={<Error />} />
          <Route path="/payment/result" element={<Result />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/post-service" element={<PostServicePage />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/registration-pending" element={<RegistrationPending />} />
          <Route path="/profile/*" element={<AdminRoutes />} />
          <Route path="/Administrator/*" element={<AdminPanel />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;