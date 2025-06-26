import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { OpportunityDetailsModal } from "./EditOfferModal";

// -- Əsas Admin Page --
interface Opportunity {
  id: string;
  title: string;
  description: string;
  location: string;
  date: string;
  status?: string;
  category_id: string;
  subcategory_id: string;
  extra_answers: string;
  budget?: number | null;
  created_at: string;
  created_by: string;
}

const OpportunitiesPageAdmin: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [profiles, setProfiles] = useState<{ [id: string]: any }>({});
  const [offers, setOffers] = useState<{ [opportunityId: string]: any[] }>({});
  const [editingOffer, setEditingOffer] = useState<{ offer: any, opportunityId: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const [detailsOpportunity, setDetailsOpportunity] = useState<Opportunity | null>(null);

  // Profilləri çəkmə funksiyası
  const fetchProfiles = async (userIds: string[]) => {
    if (!userIds.length) return {};
    const { data, error } = await supabase.from("profiles").select("*").in("id", userIds);
    if (error) return {};
    const obj: any = {};
    (data || []).forEach((profile: any) => { obj[profile.id] = profile; });
    return obj;
  };

  // Təklifləri çəkmə funksiyası
  const fetchOffers = async (opportunityIds: string[]) => {
    if (!opportunityIds.length) return {};
    const { data, error } = await supabase.from("opportunities_offers").select("*").in("opportunity_id", opportunityIds);
    if (error) return {};
    const map: any = {};
    (data || []).forEach((offer: any) => {
      if (!map[offer.opportunity_id]) map[offer.opportunity_id] = [];
      map[offer.opportunity_id].push(offer);
    });
    return map;
  };

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const { data: opps, error } = await supabase.from("opportunities").select("*").order("created_at", { ascending: false });
      if (error) { setLoading(false); return; }

      setOpportunities(opps as Opportunity[]);

      const creatorIds = Array.from(new Set((opps as Opportunity[]).map(o => o.created_by)));
      const oppIds = (opps as Opportunity[]).map(o => o.id);

      const offersMap = await fetchOffers(oppIds);
      const offerProviderIds = Object.values(offersMap).flat().map((offer: any) => offer.provider_id);
      const userIds = Array.from(new Set([...creatorIds, ...offerProviderIds]));

      const profs = await fetchProfiles(userIds);
      setProfiles(profs || {});
      setOffers(offersMap || {});
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Offer edit/save
  const handleOfferUpdate = async (offerId: string, newAmount: number, opportunityId: string) => {
    await supabase.from("opportunities_offers")
      .update({ offer_amount: newAmount })
      .eq("id", offerId);

    // Refresh after update
    const updatedOffers = await fetchOffers([opportunityId]);
    setOffers((prev) => ({
      ...prev,
      [opportunityId]: updatedOffers[opportunityId] || [],
    }));
    setEditingOffer(null);
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Bütün Fürsətlər (Admin)</h2>
      {loading ? (
        <div className="text-center text-gray-600 p-4">Fürsətlər yüklənir...</div>
      ) : (
        <div className="space-y-8">
          {opportunities.map((op) => (
            <div key={op.id} className="bg-gray-50 p-5 rounded-lg shadow-sm border border-gray-200">
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold text-lg">{op.title}</div>
                  <div className="text-sm text-gray-500">
                    <b>Yaradan:</b>{" "}
                    {profiles?.[op.created_by]
                      ? `${profiles[op.created_by].name || ""} (${profiles[op.created_by].phone_number || "—"})`
                      : op.created_by}
                  </div>
                  <div className="mt-2 text-gray-800">{op.description}</div>
                </div>
                <button
                  className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                  onClick={() => setDetailsOpportunity(op)}
                >
                  Detallara bax
                </button>
              </div>
              <div className="mt-4">
                <div className="font-semibold text-sm mb-2 text-gray-700">Qısa Təkliflər:</div>
                <ul>
                  {(offers?.[op.id] || []).length === 0 && (
                    <li className="text-xs text-gray-400">Hələ təklif yoxdur</li>
                  )}
                  {(offers?.[op.id] || []).map((offer: any) => {
                    const provider = profiles?.[offer.provider_id];
                    return (
                      <li key={offer.id} className="flex items-center gap-2 py-1">
                        <span>
                          Məbləğ: <b>{offer.offer_amount} ₼</b>
                          {provider && (
                            <span className="ml-2 text-xs text-gray-600">
                              ({provider.name}, {provider.phone_number || "—"})
                            </span>
                          )}
                        </span>
                        <button
                          className="ml-2 text-xs bg-yellow-200 rounded px-2 py-1"
                          onClick={() => setEditingOffer({ offer, opportunityId: op.id })}
                        >
                          Düzəliş et
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Fürsət detalları modalı */}
      {detailsOpportunity && (
  <OpportunityDetailsModal
    opportunity={detailsOpportunity}
    creator={profiles?.[detailsOpportunity.created_by]}
    offers={offers?.[detailsOpportunity.id] || []}
    profiles={profiles}
    onClose={() => setDetailsOpportunity(null)}
    onEditOffer={(offer: any) => setEditingOffer({ offer, opportunityId: detailsOpportunity.id })}
  />
)}
      {/* Təklif düzəliş modalı */}
      {/* {editingOffer && (
        <EditOfferModal
          offer={editingOffer.offer}
          onSave={(amount: number) => handleOfferUpdate(editingOffer.offer.id, amount, editingOffer.opportunityId)}
          onClose={() => setEditingOffer(null)}
        />
      )} */}
    </div>
  );
};

export default OpportunitiesPageAdmin;
