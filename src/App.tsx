import { useEffect, lazy, Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import {
    BrowserRouter,
    Outlet,
    Route,
    Routes
} from 'react-router-dom';
import { Footer } from './components/Footer';
import { Navbar } from './components/Navbar';
import { RandomUsers } from './components/RandomUsers';
import { RequireRole } from './components/RequireRole';
import { supabase } from './lib/supabase';
import { syncOAuthMetadataToProfile } from './lib/syncOAuthProfile';
import { useAuthStore } from './store/auth';

// ── Lazy routes — yalnız açılan səhifə yüklənir (kiçik ilk paket) ──────────
const named = <K extends string>(p: Promise<Record<K, React.ComponentType<unknown>>>, k: K) =>
  p.then((m) => ({ default: m[k] }));

const AdminPanel = lazy(() => import('./MasterAdmin/main'));
const AdminRoutes = lazy(() => import('./admin/AdminRoutes'));
const PaymentSuccess = lazy(() => import('./components/PaymentSuccess'));
const About = lazy(() => named(import('./pages/About'), 'About'));
const BookService = lazy(() => named(import('./pages/BookService'), 'BookService'));
const BookingConfirmation = lazy(() => named(import('./pages/BookingConfirmation'), 'BookingConfirmation'));
const Bookings = lazy(() => named(import('./pages/Bookings'), 'Bookings'));
const BrigadeDetail = lazy(() => import('./pages/BrigadeDetail'));
const BrigadeDispatchFullscreen = lazy(() => import('./pages/BrigadeDispatchFullscreen'));
const Brigades = lazy(() => import('./pages/Brigades'));
const CompleteProfile = lazy(() => named(import('./pages/CompleteProfile'), 'CompleteProfile'));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile'));
const DynamicServiceForm = lazy(() => import('./pages/DynamicServiceForm'));
const EditService = lazy(() => import('./pages/EditService'));
const Error = lazy(() => import('./pages/Error'));
const ForgotPassword = lazy(() => named(import('./pages/ForgotPassword'), 'ForgotPassword'));
const JoinBrigade = lazy(() => import('./pages/JoinBrigade'));
const Login = lazy(() => named(import('./pages/Login'), 'Login'));
const MyBookings = lazy(() => named(import('./pages/MyBookings'), 'MyBookings'));
const Notifications = lazy(() => import('./pages/Notifications'));
const PaymentHistory = lazy(() => named(import('./pages/PaymentHistory'), 'PaymentHistory'));
const Privacy = lazy(() => named(import('./pages/Privacy'), 'Privacy'));
const ProviderProfile = lazy(() => named(import('./pages/ProviderProfile'), 'ProviderProfile'));
const Providers = lazy(() => named(import('./pages/Providers'), 'Providers'));
const RegistrationPending = lazy(() => named(import('./pages/RegistrationPending'), 'RegistrationPending'));
const ResetPassword = lazy(() => named(import('./pages/ResetPassword'), 'ResetPassword'));
const Result = lazy(() => import('./pages/Result'));
const Signup = lazy(() => named(import('./pages/Signup'), 'Signup'));
const UpdateBalance = lazy(() => import('./pages/UpdateBalance'));
const CustomerBalance = lazy(() => import('./pages/CustomerBalance'));
const MyOpportunities = lazy(() => import('./pages/MyOpportunities'));
const Settings = lazy(() => import('./pages/Settings'));

// Route keçidləri arası yüngül yükləmə göstəricisi
const RouteFallback = () => (
  <div className="flex items-center justify-center py-32">
    <div className="w-9 h-9 rounded-full border-[3px] border-brand-100 border-t-brand-600 animate-spin" />
  </div>
);

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

// Layout — sadə tək sütun, kənar reklam banner-ləri yoxdur
const Layout = () => {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar className="sticky top-0 z-50 bg-white shadow-sm" />
      <main className="flex-grow">
        <Outlet />
      </main>
      <Footer className="bg-gray-900 text-gray-300" />
    </div>
  );
};

export function App() {
  // ── OAuth callback error handler ────────────────────────────────
  // Google/Apple OAuth-dan qayıdanda URL-də error olarsa, aydın mesaj göstər.
  // (məs. "Multiple accounts with the same email" → user-friendly izah)
  useEffect(() => {
    const hash = window.location.hash;
    const query = window.location.search;
    const errorMatch =
      query.match(/[?&]error=([^&]+)/) || hash.match(/[#&]error=([^&]+)/);
    const errorDescMatch =
      query.match(/[?&]error_description=([^&]+)/) ||
      hash.match(/[#&]error_description=([^&]+)/);

    if (!errorMatch) return;

    const errorCode = decodeURIComponent(errorMatch[1]);
    const description = errorDescMatch
      ? decodeURIComponent(errorDescMatch[1]).replace(/\+/g, ' ')
      : '';

    // İstifadəçi dostu mesaj
    let userMessage = description || errorCode;
    if (description.includes('Multiple accounts with the same email')) {
      userMessage =
        'Bu email-lə artıq başqa metodla (parol və ya başqa OAuth) qeydiyyatdan keçmisiz. ' +
        'Adi giriş edib parolu istifadə edin, yaxud admin ilə əlaqə saxlayın.';
    } else if (description.includes('access_denied')) {
      userMessage = 'Giriş ləğv edildi.';
    }

    // Async-da göstər ki, route hazır olsun
    setTimeout(() => {
      // eslint-disable-next-line no-alert
      alert(`Giriş xətası:\n\n${userMessage}`);
      // URL-i təmizlə ki hər refresh-də göstərməsin
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }, 50);
  }, []);

  // ── Global auth state sync ──────────────────────────────────────
  // Supabase session dəyişəndə (sign-in / sign-out / token refresh / başqa tab-da
  // çıxış) Zustand store-u sinxron saxlayır. Bu olmasa, başqa tab-da çıxış
  // edəndə bu tab hələ user-i göstərir.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const setUser = useAuthStore.getState().setUser;
      if (event === 'SIGNED_OUT' || !session) {
        setUser(null);
      } else if (session?.user) {
        // Yalnız əgər store-da user yoxdursa və ya fərqlidirsə yenilə
        const current = useAuthStore.getState().user;
        if (!current || current.id !== session.user.id) {
          setUser({
            id: session.user.id,
            email: session.user.email ?? '',
            name: session.user.email ?? '',
            created_at: session.user.created_at,
            role: 'customer',
            balance: 0,
          });
        }

        // OAuth metadata-nı profilə sinxron yaz (Google/Apple → email, name, avatar)
        if (event === 'SIGNED_IN') {
          void syncOAuthMetadataToProfile(session.user);
        }
      }
    });
    return () => {
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

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
    <HelmetProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
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
          <Route path="/provider/:id" element={<ProviderProfile />} />
          <Route path="/book/:serviceId" element={<BookService />} />
          <Route path="/bookings/confirmation" element={<BookingConfirmation />} />
          <Route path="/Mybookings" element={<MyBookings />} />
          <Route path="/my-opportunities" element={<MyOpportunities />} />
          <Route path="/balance" element={<CustomerBalance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/edit-service/:serviceId" element={<EditService />} />
          <Route path="/update-balance" element={<UpdateBalance />} />
          <Route path="/payment-history" element={<PaymentHistory />} />
          <Route path="/payment/Success" element={<PaymentSuccess />} />
          <Route path="/error" element={<Error />} />
          <Route path="/payment/result" element={<Result />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/brigades" element={<Brigades />} />
          <Route path="/brigades/:id" element={<BrigadeDetail />} />
          <Route path="/brigades/:id/dispatch" element={<BrigadeDispatchFullscreen />} />
          <Route path="/join/:token" element={<JoinBrigade />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/account" element={<CustomerProfile />} />
          <Route path="/complete-profile" element={<CompleteProfile />} />
          <Route path="/registration-pending" element={<RegistrationPending />} />
          <Route
            path="/account/*"
            element={
              <RequireRole role={['provider', 'admin', 'master', 'superadmin']} redirectTo="/login">
                <AdminRoutes />
              </RequireRole>
            }
          />
        </Route>
          <Route
            path="/Administrator/*"
            element={
              <RequireRole role={['admin', 'master', 'superadmin']} redirectTo="/login">
                <AdminPanel />
              </RequireRole>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </HelmetProvider>
  );
}

export default App;