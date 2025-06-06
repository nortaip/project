import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase"; // Supabase client import yolu
import ReviewModal from "./ReviewModal";

// Yenilənmiş tip: Cədvəl strukturunuza və select sorğunuza uyğun
type OpportunityOfferWithDetails = {
    id: string; // Təklifin ID-si
    status: "pending" | "accepted" | "rejected" | "completed";
    created_at: string;
    offer_amount?: number; // Sizin cədvəldə 'offer_amount' numeric
    provider_id: string; // Sizin cədvəldə 'provider_id' uuid
    // user_id?: string; // Əgər cədvələ əlavə etsəniz və select-də çəksəniz
    // message?: string; // Əgər cədvəldə varsa və çəkmək istəyirsinizsə, şərhdən çıxarın
    opportunities: {
        // 'opportunities_offers.opportunity_id' ilə bağlı 'opportunities' cədvəlindən
        title: string; // 'opportunities' cədvəlindəki 'title' sütunu
    } | null;
    // updated_at?: string; // Əgər cədvəldə varsa və istifadə edirsinizsə
};

const ServiceOffersPage: React.FC = () => {
    const [offers, setOffers] = useState<OpportunityOfferWithDetails[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentProviderId, setCurrentProviderId] = useState<string | null>(
        null
    );
    // Add a state for a specific offer being updated to show a loading spinner on its buttons
    const [updatingOfferId, setUpdatingOfferId] = useState<string | null>(null);
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [selectedOfferIdForReview, setSelectedOfferIdForReview] = useState<string | null>(null);
    useEffect(() => {
        const getCurrentProvider = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (user) {
                setCurrentProviderId(user.id);
            } else {
                setError("Provayder autentifikasiya olunmayıb.");
                setLoading(false);
            }
        };
        getCurrentProvider();
    }, []);

    const fetchOffers = useCallback(async () => {
        if (!currentProviderId) return;

        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
            .from("opportunities_offers")
            .select(
                `
        id,
        status,
        created_at,
        offer_amount,
        provider_id,
        opportunities ( title )
      `
            )
            .eq("provider_id", currentProviderId)
            .order("created_at", { ascending: false });

        if (fetchError) {
            console.error("Təklifləri çəkərkən xəta:", fetchError);
            setError(fetchError.message);
            setOffers([]);
        } else {
            setOffers(data as unknown as OpportunityOfferWithDetails[]);
        }
        setLoading(false);
    }, [currentProviderId]);

    useEffect(() => {
        if (currentProviderId) {
            fetchOffers();
        }
    }, [currentProviderId, fetchOffers]);

    const updateOfferStatus = async (
        offerId: string,
        newStatus: "pending" | "accepted" | "rejected" | "completed"
    ) => {
        setLoading(true);
        if (newStatus === "completed") {
            setSelectedOfferIdForReview(offerId);
            setShowReviewModal(true);
            return; // tamamlanmanı hələ etmə
        }

        // Əvvəlcə qəbul ediləcək təklifin məlumatlarını əldə et (opportunity_id lazım olacaq)
        const { data: selectedOffer, error: fetchError } = await supabase
            .from("opportunities_offers")
            .select("id, opportunity_id")
            .eq("id", offerId)
            .single();

        if (fetchError || !selectedOffer) {
            console.error("Təklif tapılmadı:", fetchError);
            setError("Təklif tapılmadı.");
            setLoading(false);
            return;
        }

        // Əgər status 'accepted' seçilərsə, digər təklifləri 'rejected' et
        if (newStatus === "accepted") {
            const { error: rejectOthersError } = await supabase
                .from("opportunities_offers")
                .update({ status: "rejected" })
                .eq("opportunity_id", selectedOffer.opportunity_id)
                .neq("id", offerId); // Yalnız bu təklifdən başqa olanları

            if (rejectOthersError) {
                console.error("Qalan təkliflər rədd edilərkən xəta:", rejectOthersError);
            }
        }

        // Seçilən təklifi yeni status ilə yenilə
        const { error: updateError } = await supabase
            .from("opportunities_offers")
            .update({ status: newStatus })
            .eq("id", offerId);

        if (updateError) {
            console.error("Status yenilənərkən xəta:", updateError);
            setError("Status yenilənə bilmədi.");
        } else {
            await fetchOffers();
        }

        setLoading(false);
    };

    const submitReviewAndComplete = async (rating: number, comment: string) => {
        if (!selectedOfferIdForReview) return;

        setUpdatingOfferId(selectedOfferIdForReview);

        // offer məlumatını əldə et
        const { data: offerData, error: offerErr } = await supabase
            .from("opportunities_offers")
            .select("provider_id")
            .eq("id", selectedOfferIdForReview)
            .single();

        if (offerErr || !offerData) {
            setError("Təklif tapılmadı");
            return;
        }

        // 1. Reyti yaz
        const { error: reviewError } = await supabase.from("provider_reviews").insert({
            provider_id: offerData.provider_id,
            offer_id: selectedOfferIdForReview,
            rating,
            comment,
        });

        if (reviewError) {
            setError("Reytinq əlavə edilə bilmədi");
            return;
        }

        // 2. Status-u tamamlandı et
        const { error: updateError } = await supabase
            .from("opportunities_offers")
            .update({ status: "completed" })
            .eq("id", selectedOfferIdForReview);

        if (updateError) {
            setError("Status tamamlanmadı");
        } else {
            await fetchOffers();
        }

        // Modalı bağla
        setShowReviewModal(false);
        setSelectedOfferIdForReview(null);
        setUpdatingOfferId(null);
    };

    // --- UI Rendering ---

    if (loading && offers.length === 0 && !error) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100">
                <div className="flex items-center space-x-2 text-gray-700">
                    <svg
                        className="animate-spin h-5 w-5 text-indigo-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                    >
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                        ></circle>
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                    </svg>
                    <span>Təkliflər yüklənir...</span>
                </div>
            </div>
        );
    }

    if (error && offers.length === 0) {
        return (
            <div className="flex justify-center items-center h-screen bg-gray-100">
                <div className="text-center p-6 bg-white rounded-lg shadow-md">
                    <h3 className="text-xl font-semibold text-red-600 mb-3">Xəta Baş Verdi!</h3>
                    <p className="text-gray-700">{error}</p>
                    <button
                        onClick={fetchOffers}
                        className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                    >
                        Yenidən Cəhd Edin
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-extrabold text-gray-800 mb-8 text-center">
                    Xidmətlərim
                </h2>

                {offers.length === 0 && !loading ? (
                    <div className="bg-white p-8 rounded-lg shadow-lg text-center text-gray-600">
                        <p className="text-xl font-medium mb-4">Sizin hələ hecbir xidmetiniz yoxdur</p>
                        {/* <p className="text-md">Yeni fürsətlər üçün gözləmədə qalın!</p> */}
                    </div>
                ) : (
                    <div className="space-y-6">
                        {offers.map((offer) => (
                            <div
                                key={offer.id}
                                className="bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out border border-gray-200"
                            >
                                <div className="flex flex-col md:flex-row justify-between md:items-center mb-4">
                                    <div className="mb-3 md:mb-0">
                                        <h3 className="text-xl font-bold text-indigo-800">
                                            Fürsət:{" "}
                                            {offer.opportunities?.title || "Naməlum Fürsət"}
                                        </h3>
                                        {offer.offer_amount !== undefined && (
                                            <p className="text-gray-700 text-lg mt-1">
                                                <span className="font-semibold">Təklif olunan məbləğ:</span>{" "}
                                                <span className="text-green-600 font-bold">
                                                    {offer.offer_amount} ₼
                                                </span>
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex-shrink-0">
                                        <span
                                            className={`px-4 py-2 text-sm font-semibold rounded-full uppercase tracking-wide
                        ${offer.status === "pending"
                                                    ? "bg-yellow-100 text-yellow-800"
                                                    : ""
                                                }
                        ${offer.status === "accepted"
                                                    ? "bg-green-100 text-green-800"
                                                    : ""
                                                }
                        ${offer.status === "rejected"
                                                    ? "bg-red-100 text-red-800"
                                                    : ""
                                                }
                        ${offer.status === "completed"
                                                    ? "bg-blue-100 text-blue-800"
                                                    : ""
                                                }
                      `}
                                        >
                                            {offer.status === "pending" && "Gözləmədə"}
                                            {offer.status === "accepted" && "Qəbul edilib"}
                                            {offer.status === "rejected" && "Rədd edilib"}
                                            {offer.status === "completed" && "Tamamlanıb"}
                                        </span>
                                    </div>
                                </div>

                                <div className="text-sm text-gray-500 mb-4 border-t pt-3 mt-4">
                                    Gəldi: {new Date(offer.created_at).toLocaleString()}
                                </div>

                                {offer.status === "pending" && (
                                    <div className="mt-4 flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                                        <button
                                            onClick={() => updateOfferStatus(offer.id, "accepted")}
                                            disabled={updatingOfferId === offer.id}
                                            className="flex-1 px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-base font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {updatingOfferId === offer.id ? (
                                                <span className="flex items-center justify-center">
                                                    <svg
                                                        className="animate-spin h-5 w-5 mr-3 text-white"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <circle
                                                            className="opacity-25"
                                                            cx="12"
                                                            cy="12"
                                                            r="10"
                                                            stroke="currentColor"
                                                            strokeWidth="4"
                                                        ></circle>
                                                        <path
                                                            className="opacity-75"
                                                            fill="currentColor"
                                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                        ></path>
                                                    </svg>
                                                    Qəbul Edilir...
                                                </span>
                                            ) : (
                                                "Qəbul Et"
                                            )}
                                        </button>
                                        <button
                                            onClick={() => updateOfferStatus(offer.id, "rejected")}
                                            disabled={updatingOfferId === offer.id}
                                            className="flex-1 px-5 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-base font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {updatingOfferId === offer.id ? (
                                                <span className="flex items-center justify-center">
                                                    <svg
                                                        className="animate-spin h-5 w-5 mr-3 text-white"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <circle
                                                            className="opacity-25"
                                                            cx="12"
                                                            cy="12"
                                                            r="10"
                                                            stroke="currentColor"
                                                            strokeWidth="4"
                                                        ></circle>
                                                        <path
                                                            className="opacity-75"
                                                            fill="currentColor"
                                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                        ></path>
                                                    </svg>
                                                    Rədd Edilir...
                                                </span>
                                            ) : (
                                                "Rədd Et"
                                            )}
                                        </button>
                                    </div>
                                )}
                                {offer.status === "accepted" && (
                                    <div className="mt-4">
                                        <button
                                            onClick={() => updateOfferStatus(offer.id, "completed")}
                                            disabled={updatingOfferId === offer.id}
                                            className="w-full px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-base font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {updatingOfferId === offer.id ? (
                                                <span className="flex items-center justify-center">
                                                    <svg
                                                        className="animate-spin h-5 w-5 mr-3 text-white"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                    >
                                                        <circle
                                                            className="opacity-25"
                                                            cx="12"
                                                            cy="12"
                                                            r="10"
                                                            stroke="currentColor"
                                                            strokeWidth="4"
                                                        ></circle>
                                                        <path
                                                            className="opacity-75"
                                                            fill="currentColor"
                                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                        ></path>
                                                    </svg>
                                                    Tamamlanır...
                                                </span>
                                            ) : (
                                                "Tamamlandı İşarələ"
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        <ReviewModal
                            isOpen={showReviewModal}
                            onClose={() => {
                                setShowReviewModal(false);
                                setSelectedOfferIdForReview(null);
                            }}
                            onSubmit={submitReviewAndComplete}
                        />

                    </div>
                )}
            </div>
        </div>
    );
};

export default ServiceOffersPage;