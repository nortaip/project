// ServiceOffersPage.tsx
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import ReviewModal from "./ReviewModal";

// Tip Tanımlamaları
type OpportunityOfferWithDetails = {
    id: string; // Təklifin ID-si (və ya təklifsiz fürsətlər üçün unikal ID)
    status: "pending" | "accepted" | "rejected" | "completed";
    created_at: string; // Təklifin yaradılma tarixi (və ya fürsətin yaradılma tarixi)
    offer_amount?: number; // Yalnız təklif gəlibsə mövcuddur
    provider_id?: string; // Təklifi edən provayderin ID-si, əgər varsa
    provider_full_name?: string; // Təklifi edən provayderin tam adı
    provider_phone_number?: string;

    // Fürsətə aid detallar (nested object)
    opportunities: {
        id: string; // Fürsətin ID-si
        title: string;
        description: string;
        created_at: string; // Fürsətin yaradılma tarixi
        created_by: string; // Fürsəti yaradan istifadəçinin ID-si
        creator_full_name?: string; // Fürsəti yaradan istifadəçinin tam adı
    } | null;
};

const ServiceOffersPage: React.FC = () => {
    const [offers, setOffers] = useState<OpportunityOfferWithDetails[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingOfferId, setUpdatingOfferId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null); // Renamed from currentProviderId
    const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
    const [selectedOfferIdForReview, setSelectedOfferIdForReview] = useState<string | null>(null);

    // İstifadəçi ID-sini çəkmək üçün useEffect
    useEffect(() => {
        const getCurrentUser = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (user) {
                setCurrentUserId(user.id);
            } else {
                setError("İstifadəçi autentifikasiya olunmayıb.");
                setLoading(false);
            }
        };
        getCurrentUser();
    }, []);

    // Sorğuları və Təklifləri çəkmək üçün useCallback
    const fetchRequestsAndOffers = useCallback(async () => {
        if (!currentUserId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
            .from("opportunities")
            .select(
                `
        id,
        title,
        description,
        created_at,
        created_by,
        creator_profile:profiles!fk_opportunity_created_by (name),
        opportunities_offers (
            id,
            status,
            created_at,
            offer_amount,
            provider_id,
            provider_profile:profiles (name , phone_number)
        )
        `
            )
            .eq("created_by", currentUserId)
            .order("created_at", { ascending: false });

        if (fetchError) {
            console.error("Sorğuları və təklifləri çəkərkən xəta:", fetchError);
            setError(fetchError.message);
            setOffers([]);
        } else {
            const formattedOffers: OpportunityOfferWithDetails[] = [];

            data.forEach((opportunity: any) => {
                // Fürsəti yaradanın adını təyin et
                const opportunityCreatorFullName = opportunity.creator_profile?.full_name || "Naməlum Yaradıcı";

                if (opportunity.opportunities_offers.length > 0) {
                    // Hər bir təklifi formatlayaraq əlavə et
                    opportunity.opportunities_offers.forEach((offer: any) => {
                        formattedOffers.push({
                            id: offer.id,
                            status: offer.status,
                            created_at: offer.created_at, // Offer created_at
                            offer_amount: offer.offer_amount,
                            provider_id: offer.provider_id,
                            provider_full_name: offer.provider_profile?.name || "Naməlum Provayder", // Offer provider's full name
                            provider_phone_number: offer.provider_profile?.phone_number || "Naməlum",

                            opportunities: {
                                id: opportunity.id,
                                title: opportunity.title,
                                description: opportunity.description,
                                created_at: opportunity.created_at, // Opportunity created_at
                                created_by: opportunity.created_by, // Opportunity creator ID
                                creator_full_name: opportunityCreatorFullName,
                            },
                        });
                    });
                } else {
                    // Təklif gəlməyən fürsətləri də göstərmək üçün
                    formattedOffers.push({
                        id: opportunity.id + '-no-offer', // Unikal ID təklifsiz vəziyyətlər üçün
                        status: "pending", // Hələ təklif yoxdursa "Gözləmədə" göstər
                        created_at: opportunity.created_at, // Fürsətin yaradılma tarixini istifadə et
                        offer_amount: undefined,
                        provider_id: undefined,
                        provider_full_name: undefined,

                        opportunities: {
                            id: opportunity.id,
                            title: opportunity.title,
                            description: opportunity.description,
                            created_at: opportunity.created_at,
                            created_by: opportunity.created_by,
                            creator_full_name: opportunityCreatorFullName,
                        },
                    });
                }
            });
            // Tarixə görə azalan sırada sırala (ən yeni yuxarıda)
            setOffers(
                formattedOffers.sort(
                    (a, b) =>
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime()
                )
            );
        }
        setLoading(false);
    }, [currentUserId]); // `currentUserId` dəyişəndə yenidən çək

    // `currentUserId` və `fetchRequestsAndOffers` dəyişdikdə məlumatları yenilə
    useEffect(() => {
        if (currentUserId) {
            fetchRequestsAndOffers();
        }
    }, [currentUserId, fetchRequestsAndOffers]);

    // Təklifin statusunu yeniləmək üçün funksiya
    const updateOfferStatus = async (offerId: string, newStatus: "accepted" | "rejected" | "completed") => {
        setUpdatingOfferId(offerId);
        const { error: updateError } = await supabase
            .from("opportunities_offers")
            .update({ status: newStatus })
            .eq("id", offerId);

        if (updateError) {
            console.error("Təklif statusunu yeniləyərkən xəta:", updateError);
            setError(updateError.message);
        } else {
            if (newStatus === "accepted") {
                // If accepted, mark the parent opportunity as 'active' (or similar status if you have one)
                const offerToUpdate = offers.find(o => o.id === offerId);
                if (offerToUpdate && offerToUpdate.opportunities?.id) {
                    const { error: oppUpdateError } = await supabase
                        .from("opportunities")
                        .update({ status: "active", accepted_offer_id: offerId }) // Assuming you have a 'status' and 'accepted_offer_id' column in 'opportunities'
                        .eq("id", offerToUpdate.opportunities.id);
                    if (oppUpdateError) {
                        console.error("Fürsət statusunu yeniləyərkən xəta:", oppUpdateError);
                        setError(oppUpdateError.message);
                    }
                }
            } else if (newStatus === "completed") {
                setSelectedOfferIdForReview(offerId);
                setShowReviewModal(true);
            }
            fetchRequestsAndOffers(); // Yenidən çəkib UI-ı yenilə
        }
        setUpdatingOfferId(null);
    };

    // Review göndərmək və təklifi tamamlamaq
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
            await fetchRequestsAndOffers();
        }

        // Modalı bağla
        setShowReviewModal(false);
        setSelectedOfferIdForReview(null);
        setUpdatingOfferId(null);
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <p className="text-gray-700 text-lg">Yüklənir...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <p className="text-red-500 text-lg">Xəta: {error}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
            <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-extrabold text-gray-800 mb-8 text-center">
                    Sorğularım
                </h2>

                {offers.length === 0 && !loading ? (
                    <div className="bg-white p-8 rounded-lg shadow-lg text-center text-gray-600">
                        <p className="text-xl font-medium mb-4">
                            Sizin hələ heç bir sorğunuz yoxdur.
                        </p>
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
                                            Sorğu:{" "}
                                            {offer.opportunities?.title || "Naməlum Sorğu"}
                                        </h3>
                                        <p className="text-gray-600 mt-1">
                                            Təsvir:{" "}
                                            {offer.opportunities?.description || "Təsvir yoxdur."}
                                        </p>
                                        {/* Yalnız təklif gəlibsə məbləği göstər */}
                                        {offer.offer_amount !== undefined && (
                                            <p className="text-gray-700 text-lg mt-1">
                                                <span className="font-semibold">
                                                    Təklif olunan məbləğ:
                                                </span>{" "}
                                                <span className="text-green-600 font-bold">
                                                    {offer.offer_amount} ₼
                                                </span>
                                            </p>
                                        )}
                                        {/* Yalnız provayder varsa göstər (təklif gəlibsə) */}
                                        {offer.provider_id && (
                                            <p className="text-gray-700 text-base mt-1">
                                                <span className="font-semibold">Təklifi edən:</span>{" "}
                                                {offer.provider_full_name || "Naməlum Provayder"}{" "}
                                                {offer.provider_phone_number && `(${offer.provider_phone_number})`}
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

                                {/* Düymələr yalnız təklif gəlibsə və müvafiq statusdadırsa */}
                                {offer.status === "pending" && offer.offer_amount !== undefined ? (
                                    <div className="mt-4 flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                                        <button
                                            onClick={() =>
                                                updateOfferStatus(offer.id, "accepted")
                                            }
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
                                            onClick={() =>
                                                updateOfferStatus(offer.id, "rejected")
                                            }
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
                                ) : (
                                    <>
                                        {/* Qəbul edilmiş vəziyyətdə tamamlandı düyməsini göstər */}
                                        {offer.status === "accepted" && (
                                            <div className="mt-4">
                                                <button
                                                    onClick={() =>
                                                        updateOfferStatus(offer.id, "completed")
                                                    }
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
                                        {/* Təklif gəlməyibsə, müvafiq mesaj göstər */}
                                        {!offer.provider_id && ( // Bu fürsətə aid heç bir təklif yoxdursa
                                            <p className="text-gray-500 mt-4 text-center italic">Bu sorğuya hələ təklif gəlməyib.</p>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}
                        <ReviewModal
                            isOpen={showReviewModal}
                            onClose={() => {
                                setShowReviewModal(false);
                                setSelectedOfferIdForReview(null);
                            }}
                            onSubmit={(rating, comment) => submitReviewAndComplete(rating, comment)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServiceOffersPage;