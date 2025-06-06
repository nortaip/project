import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase"; // Supabase clientinizi import edin

const BalancePage: React.FC = () => {
  const [userBalance, setUserBalance] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserBalance = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data, error } = await supabase
            .from("profiles") // Balansınızın saxlandığı cədvəl adı
            .select("balance")
            .eq("id", user.id)
            .single();

          if (error) {
            console.error("Balansı gətirərkən xəta baş verdi:", error);
            setError("Balansı gətirərkən xəta baş verdi.");
            return;
          }
          if (data) {
            setUserBalance(data.balance || 0);
          }
        } else {
          setError("İstifadəçi girişi yoxdur. Zəhmət olmasa daxil olun.");
        }
      } catch (err) {
        console.error("Balansı gətirərkən gözlənilməyən xəta:", err);
        setError("Balansı gətirərkən gözlənilməyən xəta baş verdi.");
      } finally {
        setLoading(false);
      }
    };

    fetchUserBalance();

    // Optionally, you might want to re-fetch balance if payment callback updates it
    // For a real app, consider using Supabase Realtime or a dedicated webhook
    const interval = setInterval(fetchUserBalance, 15000); // Fetch every 15 seconds for demo
    return () => clearInterval(interval);
  }, []);

  const handleTopUp = () => {
    // Epoin.az integration logic here
    // In a real application, you would generate a secure payment link
    // with parameters like user ID, amount, callback URL, etc.

    // DEMO: Redirect to a placeholder URL.
    // Replace with your actual Epoin.az integration (e.g., calling an API route).
    const epoinAzPaymentURL = "https://www.epoin.az/payment?amount=10&currency=AZN&ref=YOUR_APP_USER_ID"; // Bu bir nümunədir
    window.location.href = epoinAzPaymentURL;
  };

  if (loading) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Balansım</h2>
        <div className="bg-white p-6 rounded shadow flex flex-col gap-3">
          <p>Balans yüklənir...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 className="text-2xl font-bold mb-6">Balansım</h2>
        <div className="bg-white p-6 rounded shadow flex flex-col gap-3 text-red-600">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Balansım</h2>
      <div className="bg-white p-6 rounded shadow flex flex-col gap-3">
        <div className="text-4xl font-bold text-indigo-700">{userBalance.toFixed(2)} ₼</div>
        <div className="text-sm text-gray-500">
          Balansınızı Epoin.az vasitəsilə artıra bilərsiniz.
        </div>
        <button
          onClick={handleTopUp}
          className="bg-green-600 text-white px-6 py-3 rounded-lg text-lg font-semibold hover:bg-green-700 transition-colors mt-4"
        >
          Epoin.az ilə Balansı Artır
        </button>
        <div className="text-sm text-gray-500 mt-4">
          Yükləmə və balans tarixçəsi tezliklə burada olacaq.
        </div>
      </div>
    </div>
  );
};

export default BalancePage;