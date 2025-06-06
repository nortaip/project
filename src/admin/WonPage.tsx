import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Offer = {
  id: string;
  offer_amount: number;
  created_at: string;
  opportunity: {
    title: string;
    location: string;
  } | null;
};

const WonPage: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Function to fetch won offers
  const fetchWonOffers = async (currentUserId: string) => {
    const { data, error: fetchError } = await supabase
      .from("opportunities_offers")
      .select("id, offer_amount, created_at, opportunity:opportunities(title, location)")
      .eq("provider_id", currentUserId)
      .eq("status", "completed")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Qazandıqları təklifləri gətirərkən xəta baş verdi:", fetchError);
      setError(`Təklifləri yükləyərkən xəta baş verdi: ${fetchError.message}. Zəhmət olmasa internet bağlantınızı yoxlayın.`);
      return [];
    }

    // Map the data to ensure 'opportunity' is an object, not an array
    // Supabase directly returns the joined object if it's a one-to-one/many-to-one relation.
    const formattedData: Offer[] = (data || []).map(item => ({
      id: item.id,
      offer_amount: item.offer_amount,
      created_at: item.created_at,
      opportunity: item.opportunity as unknown as { title: string; location: string } | null, // Ensure correct type
    }));

    return formattedData;
  };

  // Effect to initialize user ID and fetch initial data
  useEffect(() => {
    const initializePage = async () => {
      setLoading(true);
      setError(null); // Clear previous errors

      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError) {
        console.error("İstifadəçi məlumatları gətirilərkən xəta:", userError);
        setError("İstifadəçi məlumatları yüklənərkən xəta baş verdi. Zəhmət olmasa yenidən daxil olun.");
        setLoading(false);
        return;
      }

      if (!user) {
        console.warn("Autentifikasiya olunmuş istifadəçi tapılmadı.");
        setError("Qazandığınız təklifləri görmək üçün daxil olmalısınız.");
        setLoading(false);
        return;
      }

      setUserId(user.id);
      const initialOffers = await fetchWonOffers(user.id);
      setOffers(initialOffers);
      setLoading(false);
    };

    initializePage();
  }, []);

  // Effect for real-time subscriptions
  useEffect(() => {
    if (!userId) return; // Only subscribe if userId is available

    console.log("Qazandıqları təkliflər üçün real-time abunə olunur:", userId);

    const offersChannel = supabase
      .channel(`won_offers_for_user_${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen for all events (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "opportunities_offers",
          filter: `provider_id=eq.${userId}`, // Filter for current user's offers
        },
        async (payload) => {
          console.log("Real-time dəyişiklik alındı:", payload);
          // Re-fetch data on any change to ensure consistency
          const updatedOffers = await fetchWonOffers(userId);
          setOffers(updatedOffers);
        }
      )
      .subscribe();

    // Cleanup subscription on component unmount
    return () => {
      console.log("Qazandıqları təkliflər kanalından abunəlik ləğv edildi.");
      supabase.removeChannel(offersChannel);
    };
  }, [userId]); // Re-subscribe if userId changes

  // --- Loading State UI ---
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center space-y-4 text-lg font-medium text-gray-700 p-8 bg-white rounded-lg shadow-xl border border-gray-200">
          <svg className="animate-spin h-10 w-10 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-xl font-semibold text-green-700">Qazandığınız təkliflər yüklənir...</span>
          <p className="text-sm text-gray-500">Zəhmət olmasa gözləyin.</p>
        </div>
      </div>
    );
  }

  // --- Error State UI ---
  if (error) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="text-center p-8 bg-white rounded-lg shadow-xl border border-red-200 max-w-md mx-auto">
          <h3 className="text-3xl font-bold text-red-700 mb-4">Xəta Baş Verdi!</h3>
          <p className="text-gray-700 mb-6 text-lg">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-red-600 text-white font-semibold rounded-md shadow-md hover:bg-red-700 transition duration-300 transform hover:scale-105"
          >
            Səhifəni Yenilə
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen font-sans">
      <h1 className="text-5xl font-extrabold text-gray-900 mb-12 text-center tracking-tight leading-tight">
        Qazandığım Fürsətlər
      </h1>

      {/* --- Empty State UI --- */}
      {offers.length === 0 && !loading && (
        <div className="text-center text-gray-600 p-12 bg-white rounded-2xl shadow-xl border border-gray-200 max-w-2xl mx-auto flex flex-col items-center justify-center space-y-6">
          <svg className="h-20 w-20 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-3xl font-bold text-gray-800">Hələ ki, qazandığınız təklif yoxdur.</p>
          <p className="text-lg text-gray-600 max-w-prose">
            Təklif etdiyiniz fürsətlərdən biri müştəri tərəfindən qəbul edildikdə, bu hissədə görünəcək.
            Uğurlar!
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="bg-white p-7 rounded-2xl shadow-xl flex flex-col justify-between border border-gray-100 transform transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl hover:border-green-300"
          >
            <div>
              <h3 className="font-extrabold text-3xl text-gray-900 mb-3 leading-snug">
                {offer.opportunity?.title || "Naməlum Fürsət"}
              </h3>

              {offer.opportunity?.location && (
                <div className="text-gray-600 text-md flex items-center mt-2 space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.05 4.05a7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  <span>{offer.opportunity.location}</span>
                </div>
              )}

              <div className="text-sm text-gray-500 mt-4 flex items-center space-x-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Təklif tarixi:{" "}
                {new Date(offer.created_at).toLocaleDateString("az-AZ", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}</span>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-5 mt-5 flex justify-between items-end">
              <span className="text-green-700 font-extrabold text-4xl">
                {offer.offer_amount} ₼
              </span>
              <span className="px-5 py-2 rounded-full text-md font-bold uppercase tracking-wide bg-green-100 text-green-800">
                QAZANDI
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WonPage;