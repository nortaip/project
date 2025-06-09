import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Offer = {
  id: string;
  offer_amount: number;
  status: string;
  created_at: string;
  opportunity: {
    title: string;
    location: string;
    description?: string;
    budget?: number | null;
    date?: string;
    user?: { // This 'user' refers to the creator of the opportunity
      name: any;
      phone_number: any;
      full_name?: string;
      email?: string;
      phone?: string;
    };
  } | null;
};

const OffersPage: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Function to fetch offers
  const fetchOffers = async (currentUserId: string) => {
    const { data, error } = await supabase
      .from("opportunities_offers")
      .select(`
    id,
    offer_amount,
    status,
    created_at,
    opportunity:opportunities!fk_opportunity (
      title,
      location,
      description,
      budget,
      date,
      user:profiles!fk_opportunity_created_by (
        name,
        email,
        phone_number
      )
    )
  `) // <-- Ensure no comments like '// <--CHANGE THIS LINE' here
      .eq("provider_id", currentUserId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Təklifləri gətirərkən xəta baş verdi:", error);
      return [];
    }

    return data as unknown as Offer[];
  };

  useEffect(() => {
    const initializeOffers = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        console.warn("No authenticated user found.");
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const initialOffers = await fetchOffers(user.id);
      setOffers(initialOffers);
      setLoading(false);
    };

    initializeOffers();
  }, []);

  useEffect(() => {
    if (!userId) return;

    const offersChannel = supabase
      .channel(`offers_for_user_${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "opportunities_offers",
          filter: `provider_id=eq.${userId}`,
        },
        async () => {
          const updatedOffers = await fetchOffers(userId);
          setOffers(updatedOffers);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(offersChannel);
    };
  }, [userId]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen font-sans">
      <h1 className="text-5xl font-extrabold text-gray-900 mb-12 text-center tracking-tight leading-tight">
        Mənim Təkliflərim
      </h1>

      {/* --- Boş Təkliflər Mesajı --- */}
      {offers.length === 0 && !loading && (
        <div className="text-center text-gray-600 p-12 bg-white rounded-2xl shadow-xl border border-gray-200 max-w-2xl mx-auto flex flex-col items-center justify-center space-y-6">
          <svg className="h-20 w-20 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3m-3 3h3m-3 3h3M18 10a2 2 0 00-2-2h-3.328a2 2 0 01-1.664-.9a2 2 0 00-3.328 0 2 2 0 01-1.664.9H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V10zM12 4v3" />
          </svg>
          <p className="text-3xl font-bold text-gray-800">Hələ ki, heç bir təklifiniz yoxdur.</p>
          <p className="text-lg text-gray-600 max-w-prose">
            Maraqlı fürsətləri gözdən keçirməyin və xidmətlərinizi təklif etməyin vaxtıdır!
            Yeniləmələri gözləyin və ya yeni fürsətlər üçün səhifəni ziyarət edin.
          </p>
          {/* Buraya yeni fürsətlər səhifəsinə yönləndirən bir düymə əlavə edə bilərsiniz */}
          {/* <button className="mt-6 px-8 py-3 bg-indigo-600 text-white font-semibold rounded-full shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-105">
            Fürsətləri Göstər
          </button> */}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-7xl mx-auto">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="bg-white p-7 rounded-2xl shadow-xl flex flex-col justify-between border border-gray-100 transform transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl hover:border-indigo-300"
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

              {offer.opportunity?.description && (
                <p className="text-gray-700 text-sm mt-4 leading-relaxed line-clamp-3">
                  {offer.opportunity.description}
                </p>
              )}

              {offer.opportunity?.budget !== null && offer.opportunity?.budget !== undefined && (
                <div className="text-xl text-green-700 font-bold mt-4 flex items-center space-x-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V9m0 3v2m0 3a5 5 0 015-5v-1a2 2 0 10-4 0v1a5 5 0 015 5h1a2 2 0 000-4h-1a5 5 0 01-5-5z" />
                  </svg>
                  <span>Təxmini büdcə: <span className="font-extrabold">{offer.opportunity.budget} AZN</span></span>
                </div>
              )}

              {offer.opportunity?.date && (
                <div className="text-sm text-gray-500 mt-3 flex items-center space-x-2">
                  <svg xmlns="http://www.w3.000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Son tarix:{" "}
                    {new Date(offer.opportunity.date).toLocaleDateString("az-AZ", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}</span>
                </div>
              )}
            </div>

            {/* Təklifin spesifik detalları və statusu */}
            <div className="border-t border-gray-200 pt-5 mt-5">
              <div className="flex justify-between items-end mb-4">
                <span className="text-indigo-700 font-extrabold text-4xl">
                  {offer.offer_amount} ₼
                </span>
                <span
                  className={`px-5 py-2 rounded-full text-md font-bold uppercase tracking-wide
                    ${offer.status === "won" ? "bg-green-100 text-green-800" : ""}
                    ${offer.status === "lost" ? "bg-red-100 text-red-600" : ""}
                    ${offer.status === "pending" ? "bg-yellow-100 text-yellow-700" : ""}
                    ${offer.status === "accepted" ? "bg-blue-100 text-blue-700" : ""}
                    ${!["won", "lost", "pending", "accepted"].includes(offer.status) ? "bg-gray-100 text-gray-700" : ""}
                  `}
                >
                  {offer.status === "won" ? "QAZANDI" :
                    offer.status === "lost" ? "İTİRDİ" :
                      offer.status === "pending" ? "GÖZLƏMƏDƏ" :
                        offer.status === "accepted" ? "QƏBUL EDİLDİ" :
                          offer.status.toUpperCase()}
                </span>
              </div>

              {/* Müştəri Əlaqə Məlumatları (Qəbul Edilmiş Təkliflər Üçün) */}
              {offer.status === "accepted" && offer.opportunity?.user && (
                <div className="bg-blue-50 p-5 rounded-xl mt-5 border border-blue-200 text-blue-800">
                  <h4 className="font-bold text-lg mb-3 flex items-center space-x-2 text-blue-900">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.3.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>Müştəri Əlaqə Məlumatları:</span>
                  </h4>
                  {offer.opportunity.user.name && (
                    <p className="text-md flex items-center mb-2 space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                      </svg>
                      <span className="font-semibold">Adı:</span> {offer.opportunity.user.name}
                    </p>
                  )}
                  {offer.opportunity.user.email && (
                    <p className="text-md flex items-center mb-2 space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                      </svg>
                      <span className="font-semibold">Email:</span>{" "}
                      <a href={`mailto:${offer.opportunity.user.email}`} className="text-blue-600 hover:underline">
                        {offer.opportunity.user.email}
                      </a>
                    </p>
                  )}
                  {offer.opportunity.user.phone_number && (
                    <p className="text-md flex items-center space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l1.3 9.1a1 1 0 01-.285.82l-1.47 1.47a9.003 9.003 0 005.578 5.578l1.47-1.47a1 1 0 01.82-.285l9.1 1.3c.693.1 1.134.711.986 1.485A1 1 0 0117 17.847V19a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
                      </svg>
                      <span className="font-semibold">Telefon:</span>{" "}
                      <a href={`tel:${offer.opportunity.user.phone_number}`} className="text-blue-600 hover:underline">
                        {offer.opportunity.user.phone_number}
                      </a>
                    </p>
                  )}
                </div>
              )}

              <div className="text-xs text-gray-400 mt-5 text-right">
                Təklif olunan tarix:{" "}
                {new Date(offer.created_at).toLocaleString("az-AZ", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OffersPage;