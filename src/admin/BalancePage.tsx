import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import * as CryptoJS from 'crypto-js'; // You might need to install crypto-js: npm install crypto-js or yarn add crypto-js

// IMPORTANT: Replace with your actual Epoint.az Public and Private Keys
// For production environments, the Private Key MUST be handled on your backend server
// to ensure security. This example is for demonstration purposes only.
const EPOINT_PUBLIC_KEY = "i000200743"; // Get this from your Epoint.az merchant panel
const EPOINT_PRIVATE_KEY = "u7OXr7CxGdQh1eKv1mKrcPzM"; // Get this from your Epoint.az merchant panel (KEEP THIS SECRET!)

const BalancePage: React.FC = () => {
  const [userBalance, setUserBalance] = useState<number>(0);
  const [bonusBalance, setBonusBalance] = useState<number>(0);
  const [bonusLogs, setBonusLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<number>(10);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          setError("İstifadəçi girişi yoxdur. Zəhmət olmasa daxil olun.");
          setLoading(false);
          return;
        }

        const [{ data: profileData, error: profileErr }, { data: walletData, error: walletErr }, { data: logData, error: logErr }] = await Promise.all([
          supabase.from("profiles").select("balance").eq("id", user.id).single(),
          supabase.from("provider_wallets").select("bonus_balance").eq("provider_id", user.id).single(),
          supabase
            .from("provider_bonus_logs")
            .select("*")
            .eq("provider_id", user.id)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);

        if (profileErr || walletErr || logErr) {
          console.error("Supabase data fetch error:", profileErr || walletErr || logErr);
          setError("Məlumatlar gətirilərkən xəta baş verdi.");
          return;
        }

        setUserBalance(profileData?.balance || 0);
        setBonusBalance(walletData?.bonus_balance || 0);
        setBonusLogs(logData || []);
      } catch (err) {
        console.error("Gözlənilməyən xəta fetchData:", err);
        setError("Məlumatlar gətirilərkən gözlənilməyən xəta baş verdi.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // const interval = setInterval(fetchData, 15000);
    // return () => clearInterval(interval);
  }, []);

  // Helper function to generate a unique order ID
  const generateUniqueOrderId = (userId: string): string => {
    return `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleTopUp = async () => {
    if (topUpAmount < 10) {
      setError("Minimum yükləmə məbləği 10 ₼ olmalıdır.");
      return;
    }

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError) {
        console.error("Error getting user from Supabase auth:", authError.message);
        setError("Hesab məlumatları alınarkən xəta baş verdi. Zəhmət olmasa yenidən cəhd edin.");
        return;
      }

      if (!user) {
        setError("Ödəniş üçün daxil olmalısınız.");
        return;
      }

      const orderId = generateUniqueOrderId(user.id);

      // IMPORTANT: Replace with your actual redirect URLs
      const successRedirectUrl = window.location.origin + "/payment/Success"; // Example: redirect to a success page
      const errorRedirectUrl = window.location.origin + "/error";     // Example: redirect to an error page

      const dataPayload = {
        public_key: EPOINT_PUBLIC_KEY,
        amount: (topUpAmount * 100).toFixed(0), // Amount in minor units (e.g., 10 AZN becomes 1000)
        currency: "AZN",
        language: "az", // Or "en", "ru"
        order_id: orderId,
        description: `Top-up for user ${user.id}`,
        success_redirect_url: successRedirectUrl,
        error_redirect_url: errorRedirectUrl,
        // Add other_attr or is_installment if needed based on your Epoint.az setup
      };

      const jsonString = JSON.stringify(dataPayload);
      const encodedData = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(jsonString));

      // Generate signature
      const rawSignatureString = EPOINT_PRIVATE_KEY + encodedData + EPOINT_PRIVATE_KEY;
      const signature = CryptoJS.enc.Base64.stringify(CryptoJS.SHA1(rawSignatureString));

      console.log("Epoint.az Data Payload:", dataPayload);
      console.log("Encoded Data:", encodedData);
      console.log("Signature:", signature);

      // Create a dynamic form and submit it via POST
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://epoint.az/api/1/checkout'; // Or 'https://epoint.az/api/1/checkout' if preferred

      const dataInput = document.createElement('input');
      dataInput.type = 'hidden';
      dataInput.name = 'data';
      dataInput.value = encodedData;
      form.appendChild(dataInput);

      const signatureInput = document.createElement('input');
      signatureInput.type = 'hidden';
      signatureInput.name = 'signature';
      signatureInput.value = signature;
      form.appendChild(signatureInput);

      document.body.appendChild(form); // Append the form to the document body
      form.submit(); // Submit the form to redirect

    } catch (err) {
      console.error("Gözlənilməyən xəta handleTopUp:", err);
      setError("Ödəniş yönləndirilməsi zamanı gözlənilməyən xəta baş verdi.");
    }
  };

  // --- Loading State ---
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-6">
        <div className="flex flex-col items-center p-8 bg-white rounded-2xl shadow-xl border border-gray-200">
          <svg className="animate-spin h-12 w-12 text-indigo-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-xl font-semibold text-gray-700">Məlumatlar yüklənir...</p>
          <p className="text-md text-gray-500 mt-2">Zəhmət olmasa gözləyin.</p>
        </div>
      </div>
    );
  }

  // --- Error State ---
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-6">
        <div className="flex flex-col items-center p-8 bg-white rounded-2xl shadow-xl border border-red-300 text-red-700">
          <svg className="h-16 w-16 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-2xl font-bold mb-3">Xəta baş verdi!</p>
          <p className="text-lg text-center mb-6 max-w-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-red-600 text-white rounded-full font-semibold shadow-md hover:bg-red-700 transition transform hover:scale-105"
          >
            Səhifəni Yenilə
          </button>
        </div>
      </div>
    );
  }

  // --- Main Content ---
  return (
    <div className="min-h-screen bg-white p-6 font-sans antialiased">
      <div className="max-w-4xl mx-auto py-12">
        <h1 className="text-5xl font-extrabold text-center text-gray-900 mb-10 drop-shadow-lg leading-tight">
          Balansım
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          {/* Main Balance Card */}
          <div className="bg-white p-8 rounded-3xl shadow-2xl border border-blue-200 flex flex-col justify-between transform transition-all duration-300 hover:scale-[1.01] hover:shadow-3xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-3 flex items-center">
              <svg className="h-7 w-7 text-indigo-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.5-7.5a.5.5 0 000 1h7a.5.5 0 000-1h-7z" clipRule="evenodd" />
              </svg>
              Əsas Balans
            </h2>
            <div className="text-6xl font-extrabold text-indigo-800 tracking-tight leading-none mb-5">
              {userBalance.toFixed(2)} ₼
            </div>
            <p className="text-gray-600 text-base">
              Əsas balansınız real pul hesabınızdır.
            </p>
          </div>

          {/* Bonus Balance Card */}
          <div className="bg-white p-8 rounded-3xl shadow-2xl border border-emerald-200 flex flex-col justify-between transform transition-all duration-300 hover:scale-[1.01] hover:shadow-3xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-3 flex items-center">
              <svg className="h-7 w-7 text-emerald-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.5 10A.5.5 0 016 9.5h8A.5.5 0 0114.5 10v1A.5.5 0 0114 11.5H6A.5.5 0 015.5 11v-1zM5 4a2 2 0 00-2 2v2a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2H5zm1 1h8a1 1 0 011 1v2a1 1 0 01-1 1H6a1 1 0 01-1-1V6a1 1 0 011-1z" clipRule="evenodd" />
                <path d="M5.5 14a.5.5 0 01.5-.5h8a.5.5 0 01.5.5v1a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5v-1z" />
              </svg>
              Bonus Balansı
            </h2>
            <div className="text-6xl font-extrabold text-emerald-700 tracking-tight leading-none mb-5">
              {bonusBalance.toFixed(2)} ₼
            </div>
            <p className="text-gray-600 text-base">
              Qazandığınız fürsətlərdən əldə etdiyiniz bonuslar burada əks olunur.
            </p>
          </div>
        </div>

        {/* Top-up Section */}
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-indigo-200 mb-10">
          <h2 className="text-2xl font-bold text-gray-800 mb-5 flex items-center">
            <svg className="h-7 w-7 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
            </svg>
            Balansı Artır
          </h2>
          <p className="text-gray-600 text-base mb-5">
            Balansınıza vəsait əlavə etmək üçün aşağıdakı sahəyə məbləği daxil edin. Minimum yükləmə məbləği **10 ₼**-dır.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch gap-4">
            <div className="relative flex-grow">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-medium">₼</span>
              <input
                type="number"
                id="topUpAmount"
                value={topUpAmount}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  setTopUpAmount(isNaN(value) ? 0 : value);
                }}
                min="10"
                step="0.01"
                className="w-full pl-12 pr-6 py-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 text-lg font-bold text-gray-800 transition duration-200"
                placeholder="Məbləğ daxil edin"
              />
            </div>
            <button
              onClick={handleTopUp}
              disabled={topUpAmount < 10}
              className={`flex-shrink-0 px-8 py-3 rounded-xl text-lg font-bold transition-all duration-300 shadow-lg ${
                topUpAmount < 10
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-green-600 text-white hover:bg-green-700 hover:shadow-xl transform hover:scale-[1.02]"
              }`}
            >
              <span className="flex items-center">
                <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Artır
              </span>
            </button>
          </div>
          {topUpAmount < 10 && (
            <p className="text-red-500 text-sm mt-3 font-medium">Minimum yükləmə məbləği 10 ₼ olmalıdır.</p>
          )}
        </div>

        {/* Bonus History Section */}
        <div className="bg-white p-8 rounded-3xl shadow-2xl border border-purple-200">
          <h2 className="text-2xl font-bold text-gray-800 mb-5 flex items-center">
            <svg className="h-7 w-7 text-purple-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2h3V1a1 1 0 011-1h2a1 1 0 011 1v2h3a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 1h6v4H7V6z" clipRule="evenodd" />
            </svg>
            Bonus Keçmişi
          </h2>
          {bonusLogs.length === 0 ? (
            <div className="bg-gray-50 p-6 rounded-xl text-gray-600 text-center text-base italic border border-gray-200">
              <svg className="h-8 w-8 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3m-3 3h3m-3 3h3M18 10a2 2 0 00-2-2h-3.328a2 2 0 01-1.664-.9a2 2 0 00-3.328 0 2 2 0 01-1.664.9H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V10zM12 4v3" />
              </svg>
              <p>Hələ ki, heç bir bonus əməliyyatı yoxdur.</p>
            </div>
          ) : (
            <ul className="space-y-4">
              {bonusLogs.map((log, idx) => (
                <li key={idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-5 bg-white rounded-xl shadow-md border border-gray-100 transition duration-200 hover:shadow-lg hover:border-indigo-100">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-3 w-full sm:w-auto mb-2 sm:mb-0">
                    <span className="font-bold text-gray-800 text-base">{log.type}</span>
                    {log.source && <span className="text-xs text-gray-500">({log.source})</span>}
                  </div>
                  <div className="flex items-center space-x-6 w-full sm:w-auto justify-between">
                    <span className="text-emerald-600 font-extrabold text-lg">+{log.amount.toFixed(2)} ₼</span>
                    <span className="text-gray-400 text-xs text-right">
                      {new Date(log.created_at).toLocaleString("az-AZ", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-sm text-gray-500 mt-10 text-center pt-6 border-t border-gray-200">
          Ətraflı yükləmə və balans tarixçəsi tezliklə burada olacaq.
        </div>
      </div>
    </div>
  );
};

export default BalancePage;