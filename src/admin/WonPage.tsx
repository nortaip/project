import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Offer = {
    id: string;
    offer_amount: number;
    status?: string; // WonPage-də yoxdur, OffersPage-də var
    created_at: string;
    opportunity: {
        title: string;
        location: string;
    } | null; // (Əgər opportunity tapılmazsa)
};


const WonPage: React.FC = () => {
    const [offers, setOffers] = useState<Offer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // TODO: provider_id-ni auth-dan götür
        const fetchWonOffers = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from("opportunities_offers")
                .select("id, offer_amount, created_at, opportunity:opportunities(title, location)")
                .eq("provider_id", (await supabase.auth.getUser()).data.user?.id)
                .eq("status", "won")
                .order("created_at", { ascending: false });
                (data || []).map((item: any) => ({
                    ...item,
                    // Opportunity həmişə array gəlir, birinci elementi götür
                    opportunity: item.opportunity && item.opportunity[0]
                      ? {
                          title: item.opportunity[0].title,
                          location: item.opportunity[0].location,
                        }
                      : null,
                  }))
            setLoading(false);
        };
        fetchWonOffers();
    }, []);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Qazandıqlarım</h2>
            {loading ? (
                <div>Yüklənir...</div>
            ) : (
                <div className="space-y-3">
                    {offers.length === 0 && <div>Qazandığınız heç bir tender yoxdur.</div>}
                    {offers.map((offer) => (
                        <div key={offer.id} className="bg-white p-4 rounded shadow flex justify-between items-center">
                            <div>
                                <div className="font-medium">{offer.opportunity?.title}</div>
                                <div className="text-gray-500 text-sm">{offer.opportunity?.location}</div>
                                <div className="text-xs text-gray-400">{new Date(offer.created_at).toLocaleString()}</div>
                            </div>
                            <span className="text-green-700 font-bold">{offer.offer_amount} ₼</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WonPage;
