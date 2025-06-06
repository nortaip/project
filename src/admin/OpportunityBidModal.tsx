import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

const OpportunityBidModal: React.FC<Props> = ({ opportunity, onClose }) => {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [userBalance, setUserBalance] = useState(0);
  const [showTopUpPrompt, setShowTopUpPrompt] = useState(false);
  // Add a state for the current user's ID
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserData = async () => {
      setLoading(true); // Indicate loading for user data fetch
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError) {
        console.error("Error fetching user:", userError);
        setLoading(false);
        return;
      }

      if (user) {
        setCurrentUserId(user.id); // Set the user ID here
        const { data, error } = await supabase
          .from("profiles") // Assuming your user balance is stored in a 'profiles' table
          .select("balance")
          .eq("id", user.id)
          .single();

        if (error) {
          console.error("Error fetching user balance:", error);
          setLoading(false);
          return;
        }
        if (data) {
          setUserBalance(data.balance || 0);
        }
      }
      setLoading(false);
    };

    fetchUserData();
  }, []); // Run once on component mount

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!currentUserId) {
      alert("Xəta: İstifadəçi ID tapılmadı. Zəhmət olmasa, yenidən daxil olun.");
      setLoading(false);
      return;
    }

    const bidAmount = parseFloat(amount);
    if (isNaN(bidAmount) || bidAmount <= 0) {
      alert("Zəhmət olmasa, etibarlı bir məbləğ daxil edin.");
      setLoading(false);
      return;
    }

    const minRequiredBalance = bidAmount * 0.10; // 10% of the bid amount

    if (userBalance < minRequiredBalance) {
      setShowTopUpPrompt(true);
      setLoading(false);
      return;
    }

    // Insert the bid into the opportunities_offers table
    // Make sure the column name matches your database schema (e.g., 'provider_id')
    const { error } = await supabase.from("opportunities_offers").insert([
      {
        opportunity_id: opportunity.id,
        offer_amount: bidAmount,
        provider_id: currentUserId, // <-- **THIS IS THE FIX!**
      },
    ]);

    if (error) {
      console.error("Təklif göndərərkən xəta baş verdi:", error);
      alert("Təklif göndərilmədi. Zəhmət olmasa, yenidən cəhd edin.");
    } else {
      // Deduct the 10% from the user's balance after successful bid
      const newBalance = userBalance - minRequiredBalance;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ balance: newBalance })
        .eq("id", currentUserId); // Use currentUserId here

      if (updateError) {
        console.error("Balans yenilənərkən xəta baş verdi:", updateError);
        // You might want to handle this more gracefully, e.g., rollback the bid
      }
      alert("Təklif uğurla göndərildi!");
      onClose();
    }
    setLoading(false);
  };

  const handleTopUp = () => {
    alert("Epoinşaz vasitəsilə balansı artırmaq üçün yönləndirilirsiniz...");
    onClose();
  };

  // Display a loading indicator while fetching user data
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
              min="0.01" // Ensure positive bid amount
              step="0.01"
            />
            <p className="text-sm text-gray-600 mb-4">
              Cari balansınız: **{userBalance.toFixed(2)} ₼**
              <br />
              Bu təklif üçün minimum tələb olunan balans (10%):{" "}
              **{(parseFloat(amount) * 0.10).toFixed(2) || "0.00"} ₼**
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-indigo-600 text-white px-4 py-2 rounded"
                disabled={loading} // Disable if still loading user data or submitting
              >
                {loading ? "Göndərilir..." : "Təklif et"}
              </button>
              <button
                type="button"
                className="bg-gray-200 px-4 py-2 rounded"
                onClick={onClose}
              >
                Bağla
              </button>
            </div>
          </form>
        ) : (
          <div>
            <p className="mb-4 text-red-600 font-semibold">
              Balansınızda kifayət qədər vəsait yoxdur! Minimum tələb olunan məbləğ:{" "}
              **{(parseFloat(amount) * 0.10).toFixed(2)} ₼**
            </p>
            <p className="mb-4">
              Cari balansınız: **{userBalance.toFixed(2)} ₼**
            </p>
            <div className="flex gap-2 justify-center">
              <button
                type="button"
                className="bg-green-600 text-white px-4 py-2 rounded"
                onClick={handleTopUp}
              >
                Epoinşaz ilə balansı artır
              </button>
              <button
                type="button"
                className="bg-gray-200 px-4 py-2 rounded"
                onClick={() => {
                  setShowTopUpPrompt(false);
                  onClose();
                }}
              >
                Ləğv et
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpportunityBidModal;