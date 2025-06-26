import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { message as antdMessage } from "antd";

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

const OpportunityBidModal: React.FC<Props> = ({ opportunity, onClose }) => {
  const [amount, setAmount] = useState<string>("");
  const [topUpAmount, setTopUpAmount] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [userBalance, setUserBalance] = useState<number>(0);
  const [showTopUpPrompt, setShowTopUpPrompt] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Balansı çək
  useEffect(() => {
    const fetchUserData = async () => {
      setLoading(true);
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        antdMessage.error("İstifadəçi tapılmadı. Yenidən daxil olun.");
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);
      const { data, error } = await supabase
        .from("profiles")
        .select("balance")
        .eq("id", user.id)
        .single();
      if (error) {
        antdMessage.error("Balans məlumatı alınmadı.");
      } else if (data) {
        setUserBalance(Number(data.balance) || 0);
      }
      setLoading(false);
    };
    fetchUserData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserId) {
      antdMessage.error("İstifadəçi ID tapılmadı. Zəhmət olmasa, yenidən daxil olun.");
      return;
    }
    const bidAmount = parseFloat(amount);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      antdMessage.error("Etibarlı məbləğ daxil edin.");
      return;
    }
    const minRequiredBalance = bidAmount * 0.10; // 10%
    if (userBalance < minRequiredBalance) {
      setShowTopUpPrompt(true);
      return;
    }

    setLoading(true);

    // Təklif əlavə et
    const { error } = await supabase.from("opportunities_offers").insert([
      {
        opportunity_id: opportunity.id,
        offer_amount: bidAmount,
        provider_id: currentUserId,
      },
    ]);

    if (error) {
      antdMessage.error("Təklif göndərilmədi. Yenidən yoxlayın.");
      setLoading(false);
      return;
    }

    // 10% balansdan çıx
    const newBalance = userBalance - minRequiredBalance;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ balance: newBalance })
      .eq("id", currentUserId);

    if (updateError) {
      antdMessage.warning("Təklif göndərildi, balans yenilənmədi. Xahiş olunur dəstəyə müraciət edin.");
    } else {
      setUserBalance(newBalance);
    }

    setAmount(""); // Formu sıfırla
    antdMessage.success("Təklif uğurla göndərildi!");
    setLoading(false);
    onClose();
  };

  // Pul yüklə
  const handleTopUp = async () => {
    if (topUpAmount < 10) {
      antdMessage.error("Minimum yükləmə məbləği 10 ₼ olmalıdır.");
      return;
    }
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        antdMessage.error("Hesab məlumatları alınmadı.");
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
      antdMessage.error("Ödəniş yönləndirilməsi zamanı xəta baş verdi.");
    }
  };

  if (loading && currentUserId === null) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 shadow-lg max-w-md w-full text-center">
          İstifadəçi məlumatları yüklənir...
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-8 shadow-lg max-w-md w-full">
        <h2 className="text-lg font-bold mb-4">
          "{opportunity.title}" üçün təklif ver
        </h2>
        {!showTopUpPrompt ? (
          <form onSubmit={handleSubmit}>
            <label className="block mb-2 font-medium">Məbləğ (₼):</label>
            <input
              required
              type="number"
              className="border px-3 py-2 w-full rounded mb-4"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.01"
              step="0.01"
              disabled={loading}
            />
            <p className="text-sm text-gray-600 mb-4">
              Cari balansınız: <b>{userBalance.toFixed(2)} ₼</b>
              <br />
              Minimum tələb olunan balans (10%): <b>{(parseFloat(amount) * 0.10 || 0).toFixed(2)} ₼</b>
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-indigo-600 text-white px-4 py-2 rounded"
                disabled={loading}
              >
                {loading ? "Göndərilir..." : "Təklif et"}
              </button>
              <button
                type="button"
                className="bg-gray-200 px-4 py-2 rounded"
                onClick={onClose}
                disabled={loading}
              >
                Bağla
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mb-4 text-red-600 font-semibold">
              Balansınızda kifayət qədər vəsait yoxdur! Minimum tələb olunan məbləğ: <b>{(parseFloat(amount) * 0.10 || 0).toFixed(2)} ₼</b>
            </p>
            <p className="mb-4">
              Cari balansınız: <b>{userBalance.toFixed(2)} ₼</b>
            </p>
            <label className="block mb-2">Yükləmə məbləği (minimum 10₼):</label>
            <input
              type="number"
              className="border px-3 py-2 w-full rounded mb-4"
              value={topUpAmount}
              min={10}
              step="1"
              onChange={e => setTopUpAmount(Number(e.target.value))}
            />
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                className="bg-green-600 text-white px-4 py-2 rounded"
                onClick={handleTopUp}
              >
                Balansı artır
              </button>
              <button
                type="button"
                className="bg-gray-200 px-4 py-2 rounded"
                onClick={() => {
                  setShowTopUpPrompt(false);
                  // onClose(); // istəsən burda da bağlana bilər
                }}
              >
                Geri qayıt
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpportunityBidModal;
