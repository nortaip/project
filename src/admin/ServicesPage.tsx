import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import ReviewModal from "./ReviewModal";

// Tip Tanımlamaları (Mövcud tipləriniz)
type OpportunityOfferWithDetails = {
    id: string;
    status: "pending" | "accepted" | "rejected" | "completed";
    created_at: string;
    offer_amount?: number;
    provider_id?: string;
    provider_full_name?: string;
    provider_phone_number?: string;
    opportunities: {
        id: string;
        title: string;
        description: string;
        created_at: string;
        created_by: string;
        creator_full_name?: string;
        accepted_offer_id?: string; // Add this since you are now dealing with it
    } | null;
};

const ServiceOffersPage: React.FC = () => {
    const [offers, setOffers] = useState<OpportunityOfferWithDetails[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingOfferId, setUpdatingOfferId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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
creator_profile:profiles!fk_opportunity_created_by(name),                
opportunities_offers!fk_opportunity (
id,
            status,         
                created_at,               
                offer_amount,                
                provider_id, provider_profile:profiles(name, phone_number) ),accepted_offer:opportunities_offers!fk_accepted_offer (id,
offer_amount,
provider_profile:profiles(name, phone_number)
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
                const opportunityCreatorFullName = opportunity.creator_profile?.full_name || "Naməlum Yaradıcı";

                if (opportunity.opportunities_offers.length > 0) {
                    opportunity.opportunities_offers.forEach((offer: any) => {
                        formattedOffers.push({
                            id: offer.id,
                            status: offer.status,
                            created_at: offer.created_at,
                            offer_amount: offer.offer_amount,
                            provider_id: offer.provider_id,
                            provider_full_name: offer.provider_profile?.name || "Naməlum Provayder",
                            provider_phone_number: offer.provider_profile?.phone_number || "Naməlum",
                            opportunities: {
                                id: opportunity.id,
                                title: opportunity.title,
                                description: opportunity.description,
                                created_at: opportunity.created_at,
                                created_by: opportunity.created_by,
                                creator_full_name: opportunityCreatorFullName,
                                accepted_offer_id: opportunity.accepted_offer_id, // Include this
                            },
                        });
                    });
                } else {
                    // Handle cases where no offers exist for an opportunity
                    // Ensure a unique ID by combining opportunity.id and a suffix
                    formattedOffers.push({
                        id: opportunity.id + '-no-offer',
                        status: "pending", // Or some other appropriate default status
                        created_at: opportunity.created_at,
                        offer_amount: undefined,
                        provider_id: undefined,
                        provider_full_name: undefined,
                        provider_phone_number: undefined,
                        opportunities: {
                            id: opportunity.id,
                            title: opportunity.title,
                            description: opportunity.description,
                            created_at: opportunity.created_at,
                            created_by: opportunity.created_by,
                            creator_full_name: opportunityCreatorFullName,
                            accepted_offer_id: opportunity.accepted_offer_id, // Include this
                        },
                    });
                }
            });
            setOffers(
                formattedOffers.sort(
                    (a, b) =>
                        new Date(b.created_at).getTime() -
                        new Date(a.created_at).getTime()
                )
            );
        }
        setLoading(false);
    }, [currentUserId]);

    useEffect(() => {
        if (currentUserId) {
            fetchRequestsAndOffers();
        }
    }, [currentUserId, fetchRequestsAndOffers]);

    // Helper function to repay commissions for rejected offers
    const repayCommissionsForRejectedOffers = async (
        rejectedOffers: { id: string; provider_id: string; offer_amount: number }[]
    ) => {
        for (const rejectedOffer of rejectedOffers) {
            const refundAmount = parseFloat((rejectedOffer.offer_amount * 0.1).toFixed(2)); // 10%

            console.log(`Refunding 10% commission (${refundAmount}) for offer ID: ${rejectedOffer.id}`);

            // 1. Refund log yaz (provider_commissions_logs)
            const { error: insertRefundLogError } = await supabase
                .from('provider_commissions_logs')
                .insert({
                    provider_id: rejectedOffer.provider_id,
                    offer_id: rejectedOffer.id,
                    amount: refundAmount,
                    type: 'refund',
                    source: 'Təklif imtinası',
                    status: 'refunded',
                    refunded_at: new Date().toISOString(),
                    created_at: new Date().toISOString()
                });

            if (insertRefundLogError) {
                console.error(`Error inserting refund log for offer ${rejectedOffer.id}:`, insertRefundLogError);
                continue;
            }

            // 2. Update provider_wallets.bonus_balance
            const { data: providerWallet, error: walletFetchError } = await supabase
                .from('provider_wallets')
                .select('bonus_balance')
                .eq('provider_id', rejectedOffer.provider_id)
                .single();

            if (!walletFetchError && providerWallet) {
                const newBonusBalance = (providerWallet.bonus_balance || 0) + refundAmount;

                const { error: walletUpdateError } = await supabase
                    .from('provider_wallets')
                    .update({ bonus_balance: newBonusBalance })
                    .eq('provider_id', rejectedOffer.provider_id);

                if (walletUpdateError) {
                    console.error(`Error updating provider wallet bonus balance:`, walletUpdateError);
                } else {
                    console.log(`Wallet bonus balance updated: +${refundAmount}, new: ${newBonusBalance}`);
                }
            } else {
                console.error(`Error fetching provider wallet:`, walletFetchError);
            }

            // 3. Update profiles.balance
            const { data: profile, error: profileFetchError } = await supabase
                .from('profiles')
                .select('balance')
                .eq('id', rejectedOffer.provider_id)
                .single();

            if (!profileFetchError && profile) {
                const newProfileBalance = (profile.balance || 0) + refundAmount;

                const { error: profileUpdateError } = await supabase
                    .from('profiles')
                    .update({ balance: newProfileBalance })
                    .eq('id', rejectedOffer.provider_id);

                if (profileUpdateError) {
                    console.error(`Error updating profile balance:`, profileUpdateError);
                } else {
                    console.log(`Profile balance updated: +${refundAmount}, new: ${newProfileBalance}`);
                }
            } else {
                console.error(`Error fetching profile:`, profileFetchError);
            }

            // 4. BONUS LOG (Əgər cədvəlin adı fərqlidirsə, dəyiş)
            const { error: bonusLogInsertError } = await supabase
                .from('provider_bonus_logs')
                .insert({
                    provider_id: rejectedOffer.provider_id,
                    amount: refundAmount,
                    type: 'refund',
                    source: 'Təklif imtinası', // <--- Vacib hissə
                    created_at: new Date().toISOString(),
                    reason: 'Offer rejected - commission refunded'
                });

            if (bonusLogInsertError) {
                console.error(`Error inserting bonus log:`, bonusLogInsertError);
            } else {
                console.log(`Bonus log yazıldı: ${refundAmount} for provider ${rejectedOffer.provider_id}`);
            }
        }
    };

    const updateOfferStatus = async (offerId: string, newStatus: "accepted" | "rejected" | "completed") => {
        setUpdatingOfferId(offerId);
        let errorOccurred = false;

        try {
            // Step 1: Fetch the offer to get its opportunity_id
            const { data: offerToUpdateData, error: fetchOfferError } = await supabase
                .from("opportunities_offers")
                .select("opportunity_id") // Make sure you select opportunity_id here
                .eq("id", offerId)
                .single();

            if (fetchOfferError || !offerToUpdateData) {
                console.error("Error fetching offer to update:", fetchOfferError);
                setError(fetchOfferError?.message || "Təklif məlumatları tapılmadı.");
                errorOccurred = true;
                return;
            }

            const opportunityId = offerToUpdateData.opportunity_id;

            // Step 2: Update the status of the selected offer
            const { error: updateError } = await supabase
                .from("opportunities_offers")
                .update({ status: newStatus })
                .eq("id", offerId);

            if (updateError) {
                console.error("Təklif statusunu yeniləyərkən xəta:", updateError);
                setError(updateError.message);
                errorOccurred = true;
                return;
            }

            if (newStatus === "accepted") {
                // Step 3: If accepted, reject other offers for the same opportunity
                // Fetch other pending offers for this opportunity
                const { data: otherOffers, error: otherOffersError } = await supabase
                    .from("opportunities_offers")
                    .select("id, provider_id, offer_amount") // Select necessary fields for commission repayment
                    .eq("opportunity_id", opportunityId)
                    .eq("status", "pending") // Only reject pending ones
                    .neq("id", offerId); // Exclude the accepted offer itself

                if (otherOffersError) {
                    console.error("Error fetching other offers for rejection:", otherOffersError);
                    // Do not set error here, as the primary action (accepting) was successful.
                    // Just log and continue, as this is a secondary action.
                }

                if (otherOffers && otherOffers.length > 0) {
                    // Update status of other offers to 'rejected'
                    const { error: rejectOthersError } = await supabase
                        .from("opportunities_offers")
                        .update({ status: "rejected" })
                        .in("id", otherOffers.map(o => o.id));

                    if (rejectOthersError) {
                        console.error("Error rejecting other offers:", rejectOthersError);
                        // Log but don't stop the main flow.
                    } else {
                        console.log(`Rejected ${otherOffers.length} other offers for opportunity ${opportunityId}.`);

                        // Step 4: Repay commissions for rejected offers
                        await repayCommissionsForRejectedOffers(otherOffers);
                    }
                }

                // Update opportunity status and accepted_offer_id
                const { error: oppUpdateError } = await supabase
                    .from("opportunities")
                    .update({ status: "active", accepted_offer_id: offerId })
                    .eq("id", opportunityId); // Use the fetched opportunityId

                if (oppUpdateError) {
                    console.error("Fürsət statusunu yeniləyərkən xəta:", oppUpdateError);
                    setError(oppUpdateError.message);
                    errorOccurred = true;
                }
            } else if (newStatus === "completed") {
                setSelectedOfferIdForReview(offerId);
                setShowReviewModal(true);
            }
        } catch (err) {
            console.error("An unexpected error occurred in updateOfferStatus:", err);
            setError("Gözlənilməyən xəta baş verdi: " + (err instanceof Error ? err.message : String(err)));
            errorOccurred = true;
        } finally {
            setUpdatingOfferId(null);
            if (!errorOccurred) {
                fetchRequestsAndOffers(); // Re-fetch all offers to update UI
            }
        }
    };

    const grantBonusToProvider = async (providerId: string, cashbackAmount: number) => {
        const now = new Date().toISOString();

        // 1. Bonus log-a yaz
        const { error: bonusLogError } = await supabase
            .from("provider_bonus_logs")
            .insert({
                provider_id: providerId,
                amount: cashbackAmount,
                type: "cashback",
                source: "review_cashback",
                created_at: now,
                reason: "Review tamamlandıqdan sonra 20% cashback verildi"
            });

        if (bonusLogError) {
            throw new Error("Bonus log əlavə olunmadı: " + bonusLogError.message);
        }

        // 2. Provayderin balansını yenilə
        const { data: walletData, error: walletFetchError } = await supabase
            .from("provider_wallets")
            .select("bonus_balance")
            .eq("provider_id", providerId)
            .single();

        if (walletFetchError || !walletData) {
            throw new Error("Provayder balansı tapılmadı: " + (walletFetchError?.message || "Unknown"));
        }

        const newBalance = (walletData.bonus_balance || 0) + cashbackAmount;

        const { error: updateWalletError } = await supabase
            .from("provider_wallets")
            .update({ bonus_balance: newBalance })
            .eq("provider_id", providerId);

        if (updateWalletError) {
            throw new Error("Bonus balans güncəllənmədi: " + updateWalletError.message);
        }
    };


    const submitReviewAndComplete = async (rating: number, comment: string) => {
        if (!selectedOfferIdForReview) return;

        setUpdatingOfferId(selectedOfferIdForReview);

        // offer məlumatını əldə et - price_offer-i də seçirik!
        const { data: offerData, error: offerErr } = await supabase
            .from("opportunities_offers")
            .select("provider_id, offer_amount")
            .eq("id", selectedOfferIdForReview)
            .single();

        if (offerErr || !offerData) {
            console.error("Error fetching offer data:", offerErr);
            setError("Təklif tapılmadı: " + (offerErr?.message || "Unknown error"));
            setUpdatingOfferId(null);
            return;
        }

        // Add logging for provider_id
        console.log("Offer Data Retrieved:", offerData);
        if (!offerData.provider_id) {
            console.error("Error: offerData.provider_id is null or undefined for offerId:", selectedOfferIdForReview);
            setError("Təklifə aid provayder ID-si tapılmadı. Zəhmət olmasa, yenidən cəhd edin.");
            setUpdatingOfferId(null);
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
            setError("Reytinq əlavə edilə bilmədi: " + reviewError.message);
            setUpdatingOfferId(null);
            return;
        }

        const offerAmount = offerData.offer_amount || 0;
        const cashbackAmount = parseFloat((offerAmount * 0.2).toFixed(2)); // ✅ 1.80 olaraq qalır

        try {
            await grantBonusToProvider(offerData.provider_id, cashbackAmount);
            console.log(`✅ ${cashbackAmount} cashback uğurla əlavə olundu`);
        } catch (error) {
            console.error("❌ Cashback zamanı xəta:", error);
            setError("Bonus əlavə olunarkən xəta baş verdi: " + (error instanceof Error ? error.message : String(error)));
            setUpdatingOfferId(null);
            return;
        }

        // 2. Status-u tamamlandı et
        const { error: updateError } = await supabase
            .from("opportunities_offers")
            .update({ status: "completed" })
            .eq("id", selectedOfferIdForReview);

        if (updateError) {
            setError("Status tamamlanmadı: " + updateError.message);
        } else {
            await fetchRequestsAndOffers();
        }

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
                                                <span className="flex items-center justify-content">
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
                                                        "Tamamla və Reytinq Ver"
                                                    )}
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}

                                {offer.opportunities && !offer.provider_id && (
                                    <p className="text-gray-500 italic mt-4">
                                        Bu sorğu üçün hələ heç bir təklif yoxdur.
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showReviewModal && selectedOfferIdForReview && (
                <ReviewModal
                    isOpen={showReviewModal}
                    onClose={() => setShowReviewModal(false)}
                    onSubmit={submitReviewAndComplete}
                // Remove offerId prop since it's not defined in ReviewModalProps
                />
            )}
        </div>
    );
};

export default ServiceOffersPage;