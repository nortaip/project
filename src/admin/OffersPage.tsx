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
    };
};

const OffersPage: React.FC = () => {
    const [offers, setOffers] = useState<Offer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // TODO: provider_id-ni auth-dan götür
        const fetchOffers = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from("opportunities_offers")
                .select("id, offer_amount, status, created_at, opportunity:opportunities(title, location)")
                .eq("provider_id", (await supabase.auth.getUser()).data.user?.id)
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
        fetchOffers();
    }, []);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Təkliflərim</h2>
            {loading ? (
                <div>Yüklənir...</div>
            ) : (
                <div className="space-y-3">
                    {offers.length === 0 && <div>Heç bir təklifiniz yoxdur.</div>}
                    {offers.map((offer) => (
                        <div key={offer.id} className="bg-white p-4 rounded shadow flex justify-between items-center">
                            <div>
                                <div className="font-medium">{offer.opportunity?.title}</div>
                                <div className="text-gray-500 text-sm">{offer.opportunity?.location}</div>
                                <div className="text-xs text-gray-400">{new Date(offer.created_at).toLocaleString()}</div>
                            </div>
                            <div>
                                <span className="text-indigo-700 font-bold">{offer.offer_amount} ₼</span>
                                <span className={`ml-4 px-2 py-1 rounded text-xs ${offer.status === "won" ? "bg-green-100 text-green-800" : offer.status === "lost" ? "bg-red-100 text-red-600" : "bg-yellow-100 text-yellow-700"}`}>
                                    {offer.status === "won" ? "QAZANDI" : offer.status === "lost" ? "İTİRDİ" : "GÖZLƏMƏDƏ"}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default OffersPage;
