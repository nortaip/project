import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { message } from "antd"; // Ant Design message component for notifications

export async function updateUserBalance(userId: string, amount: number) {
  const { data: wallet, error: fetchError } = await supabase
    .from("provider_wallets")
    .select("balance")
    .eq("provider_id", userId)
    .single();

  if (fetchError || !wallet) {
    console.error("Balans tapılmadı:", fetchError?.message);
    return false;
  }

  const newBalance = Number(wallet.balance) + Number(amount);

  const { error: updateError } = await supabase
    .from("provider_wallets")
    .update({ balance: newBalance })
    .eq("provider_id", userId);

  if (updateError) {
    console.error("Balans yenilənmədi:", updateError.message);
    return false;
  }

  return true;
}

const BalancePage: React.FC = () => {
  const [userBalance, setUserBalance] = useState<number>(0);
  const [bonusBalance, setBonusBalance] = useState<number>(0);
  const [bonusLogs, setBonusLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [topUpAmount, setTopUpAmount] = useState<number>(10);
  const [converting, setConverting] = useState<boolean>(false);

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
  
      // Profili və log-ları paralel gətir
      const [
        { data: profileData, error: profileErr },
        { data: logData, error: logErr }
      ] = await Promise.all([
        supabase.from("profiles").select("balance").eq("id", user.id).single(),
        supabase
          .from("provider_bonus_logs")
          .select("*")
          .eq("provider_id", user.id)
          .order("created_at", { ascending: false })
      ]);
  
      if (profileErr || logErr) {
        console.error("Supabase fetch error:", profileErr || logErr);
        setError("Məlumatlar gətirilərkən xəta baş verdi.");
        return;
      }
  
      // 👇 Əgər provider_wallets məlumatı yoxdursa, əlavə et və ya təkrar al
      let walletData;
      const { data: fetchedWallet, error: fetchWalletError } = await supabase
        .from("provider_wallets")
        .select("*")
        .eq("provider_id", user.id)
        .maybeSingle();
  
      if (fetchWalletError) {
        console.error("Wallet fetch xətası:", fetchWalletError.message);
        setError("Balans məlumatı alınarkən xəta baş verdi.");
        return;
      }
  
      if (!fetchedWallet) {
        const { error: insertWalletErr } = await supabase
          .from("provider_wallets")
          .insert({
            provider_id: user.id,
            bonus_balance: 0,
            balance: 0
          });
  
        if (insertWalletErr) {
          if (insertWalletErr.message.includes("duplicate key")) {
            const { data: refetch, error: refetchErr } = await supabase
              .from("provider_wallets")
              .select("*")
              .eq("provider_id", user.id)
              .single();
  
            if (refetchErr || !refetch) {
              setError("Balans məlumatı təkrar gətirilə bilmədi.");
              return;
            }
  
            walletData = refetch;
          } else {
            console.error("Yeni provider_wallets yazılarkən xəta:", insertWalletErr.message);
            setError("Bonus balansı yaratmaq mümkün olmadı.");
            return;
          }
        } else {
          walletData = { bonus_balance: 0 };
        }
      } else {
        walletData = fetchedWallet;
      }
  
      // Məlumatları state-lərə yaz
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
  

  useEffect(() => {
    fetchData();
  }, []);

  const handleTopUp = async () => {
    if (topUpAmount < 10) {
      message.error("Minimum yükləmə məbləği 10 ₼ olmalıdır.");
      return;
    }

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        console.error("Error getting user from Supabase auth:", authError?.message);
        message.error("Hesab məlumatları alınarkən xəta baş verdi. Zəhmət olmasa yenidən cəhd edin.");
        return;
      }

      const orderId = `user_${user.id}_order_${Date.now()}`;
      const successUrl = `${window.location.origin}/payment/success?status=success&orderId=${encodeURIComponent(orderId)}`;

      const response = await fetch('https://ellit.az/data/initiate_epoint_payment.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          amount: topUpAmount.toFixed(2),
          user_id: user.id,
          success_url: successUrl
        })
      });

      const html = await response.text();
      const w = window.open();
      if (w) w.document.write(html);
    } catch (err) {
      console.error("Gözlənilməyən xəta handleTopUp:", err);
      message.error("Ödəniş yönləndirilməsi zamanı gözlənilməyən xəta baş verdi.");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Function to handle converting bonus balance to main balance
  const handleConvertBonus = async () => {
    if (bonusBalance < 5) {
      message.error("Balansı çevirmək üçün minimum 5 ₼ bonusunuz olmalıdır.");
      return;
    }

    setConverting(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        message.error("İstifadəçi məlumatları tapılmadı. Zəhmət olmasa yenidən cəhd edin.");
        setConverting(false);
        return;
      }

      // Fetch current balances to ensure atomic update (though Supabase update is usually sufficient)
      const { data: profileData, error: profileErr } = await supabase
        .from("profiles")
        .select("balance")
        .eq("id", user.id)
        .single();

      const { data: walletData, error: walletErr } = await supabase
        .from("provider_wallets")
        .select("bonus_balance")
        .eq("provider_id", user.id)
        .single();

      if (profileErr || walletErr || !profileData || !walletData) {
        throw new Error("Cari balans məlumatları gətirilərkən xəta baş verdi.");
      }

      const currentMainBalance = profileData.balance || 0;
      const currentBonusBalance = walletData.bonus_balance || 0;

      // Ensure the bonus balance hasn't changed since the component loaded
      if (currentBonusBalance < 5 || currentBonusBalance !== bonusBalance) {
        message.error("Bonus balansınız dəyişib və ya çevrilmə üçün kifayət deyil. Zəhmət olmasa səhifəni yeniləyin.");
        setConverting(false);
        return;
      }

      const amountToConvert = currentBonusBalance; // Convert all available bonus balance

      // 1. Update profiles.balance (add bonus to main balance)
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ balance: currentMainBalance + amountToConvert })
        .eq("id", user.id);

      if (updateProfileError) {
        throw new Error("Əsas balans yenilənərkən xəta: " + updateProfileError.message);
      }

      // 2. Update provider_wallets.bonus_balance (set bonus to 0)
      const { error: updateWalletError } = await supabase
        .from("provider_wallets")
        .update({ bonus_balance: 0 })
        .eq("provider_id", user.id);

      if (updateWalletError) {
        throw new Error("Bonus balans yenilənərkən xəta: " + updateWalletError.message);
      }

      // 3. Insert a log entry for the conversion
      const { error: logError } = await supabase
        .from("provider_bonus_logs")
        .insert({
          provider_id: user.id,
          amount: amountToConvert,
          type: 'conversion',
          source: 'bonus_to_main_balance',
          created_at: new Date().toISOString(),
          reason: `Bonus balansından əsas balansa çevrilmə (${amountToConvert} ₼)`
        });

      if (logError) {
        console.error("Bonus çevrilmə logu yazılarkən xəta:", logError);
        // Do not throw error, as balances are already updated. Just log.
      }

      message.success(`${amountToConvert.toFixed(2)} ₼ bonus uğurla əsas balansa çevrildi!`);
      await fetchData(); // Re-fetch data to update UI with new balances
    } catch (err: any) {
      console.error("Bonus çevrilməsi zamanı gözlənilməyən xəta:", err);
      message.error("Bonus çevrilməsi zamanı xəta baş verdi: " + err.message);
    } finally {
      setConverting(false);
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
              {(userBalance && userBalance > 0 ? userBalance.toFixed(2) : "0.00")} ₼
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
              {(bonusBalance > 0 ? bonusBalance.toFixed(2) : "0.00")} ₼
            </div>
            <p className="text-gray-600 text-base mb-4">
              Qazandığınız fürsətlərdən əldə etdiyiniz bonuslar burada əks olunur.
            </p>

            {/* Convert Bonus to Balance Button */}
            {bonusBalance >= 5 && (
              <button
                onClick={handleConvertBonus}
                disabled={converting}
                className={`w-full px-5 py-3 mt-4 rounded-xl text-lg font-bold transition-all duration-300 shadow-md flex items-center justify-center 
                  ${converting
                    ? "bg-gray-400 text-gray-700 cursor-not-allowed"
                    : "bg-purple-600 text-white hover:bg-purple-700 hover:shadow-xl transform hover:scale-[1.02]"
                  }`}
              >
                {converting ? (
                  <>
                    <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Çevrilir...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Bonusu Balansa Çevir
                  </>
                )}
              </button>
            )}
            {bonusBalance < 5 && (
              <p className="text-gray-500 text-sm mt-3 font-medium text-center">
                Balansı çevirmək üçün minimum 5 ₼ bonus lazımdır.
              </p>
            )}
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
              className={`flex-shrink-0 px-8 py-3 rounded-xl text-lg font-bold transition-all duration-300 shadow-lg ${topUpAmount < 10
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
                    <span className="font-bold text-gray-800 text-base">{log.type === 'conversion' ? 'Çevrilmə' : log.type}</span> {/* Translate type */}
                    {log.source && <span className="text-xs text-gray-500">({log.source === 'bonus_to_main_balance' ? 'Əsas balansa çevrilmə' : log.source})</span>} {/* Translate source */}
                  </div>
                  <div className="flex items-center space-x-6 w-full sm:w-auto justify-between">
                    <span className={`font-extrabold text-lg ${log.type === 'conversion' || log.type === 'refund' ? 'text-blue-600' : 'text-emerald-600'}`}>
                      {log.type === 'conversion' ? '-' : '+'}{log.amount.toFixed(2)} ₼
                    </span>
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