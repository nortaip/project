import React, { useState } from "react";
import { supabase } from "../lib/supabase";

type Props = {
  opportunity: { id: string; title: string };
  onClose: () => void;
};

const OpportunityBidModal: React.FC<Props> = ({ opportunity, onClose }) => {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Demo: təklifi opportunities_offers cədvəlinə yazırıq
    await supabase.from("opportunities_offers").insert([
      { opportunity_id: opportunity.id, offer_amount: amount },
    ]);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-8 shadow-lg max-w-md w-full">
        <h2 className="text-lg font-bold mb-4">
          "{opportunity.title}" üçün təklif ver
        </h2>
        <form onSubmit={handleSubmit}>
          <label className="block mb-2 font-medium">Məbləğ (₼):</label>
          <input
            required
            type="number"
            className="border px-3 py-2 w-full rounded mb-4"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-indigo-600 text-white px-4 py-2 rounded"
              disabled={loading}
            >
              {loading ? "Göndərilir..." : "Təklif et"}
            </button>
            <button type="button" className="bg-gray-200 px-4 py-2 rounded" onClick={onClose}>
              Bağla
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OpportunityBidModal;
