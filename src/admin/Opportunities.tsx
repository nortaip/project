import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import OpportunityBidModal from "./OpportunityBidModal.tsx";

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
  created_at?: string;
}

const OpportunitiesPage: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(false);

  // Kategoriya və subkategoriya yüklə
  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
    supabase.from("service_subcategories").select("*").then(({ data }) => setSubcategories(data || []));
  }, []);

  // Əsas realtime funksiyası
  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      setLoading(true);
      const { data } = await supabase
        .from("opportunities")
        .select("*")
        .order("created_at", { ascending: false });
      if (mounted && data) setOpportunities(data);
      setLoading(false);
    }
    fetchData();

    // REALTIME: Supabase kanalında dinlə
    const channel = supabase
      .channel('realtime:opportunities')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opportunities' },
        (payload: any) => {
          setOpportunities((prev) => {
            // Yeni əlavə olundu
            if (payload.eventType === "INSERT") {
              // Eyni id yoxdursa əlavə et (topa əlavə)
              if (!prev.find((op) => op.id === payload.new.id)) {
                return [payload.new, ...prev];
              }
            }
            // Yeniləndi
            if (payload.eventType === "UPDATE") {
              return prev.map((op) => (op.id === payload.new.id ? payload.new : op));
            }
            // Silindi
            if (payload.eventType === "DELETE") {
              return prev.filter((op) => op.id !== payload.old.id);
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Kategoriya və altkategoriya adı
  const getCategoryLabel = (id: string) => categories.find((c) => c.id === id)?.label || "";
  const getSubcategoryLabel = (id: string) => subcategories.find((c) => c.id === id)?.label || "";

  // JSON parse helper
  const parseExtraAnswers = (jsonString: string) => {
    try {
      const obj = JSON.parse(jsonString || "{}");
      return Object.entries(obj);
    } catch {
      return [];
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Fırsatlarım</h2>
      {loading ? (
        <div>Yüklənir...</div>
      ) : (
        <div className="space-y-4">
          {opportunities.map((op) => {
            const extra = parseExtraAnswers(op.extra_answers);

            return (
              <div key={op.id} className="bg-white p-5 rounded-xl shadow flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-lg">{op.title}</div>
                    <div className="text-xs text-gray-500 mb-1">
                      {getCategoryLabel(op.category_id)}
                      {op.subcategory_id ? " / " + getSubcategoryLabel(op.subcategory_id) : ""}
                    </div>
                  </div>
                  <button
                    className="bg-indigo-600 text-white rounded px-4 py-2"
                    onClick={() => setSelectedOpportunity(op)}
                  >
                    Təklif ver
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {op.budget && (
                    <div className="text-sm text-green-700 font-bold">
                      Təxmini büdcə: <span className="text-base">{op.budget} AZN</span>
                    </div>
                  )}
                  <div className="text-gray-800">{op.description}</div>
                  {extra.length > 0 && (
                    <div className="bg-gray-50 border rounded p-3">
                      <div className="font-medium text-gray-600 mb-1 text-sm">Əlavə suallar və cavablar:</div>
                      <ul className="text-sm space-y-1">
                        {extra.map(([k, v]) => (
                          <li key={k}>
                            <span className="font-medium capitalize">{k.replace(/_/g, " ")}:</span>{" "}
                            <span>{String(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-row justify-between items-center mt-2">
                    <span className="text-xs text-gray-400">{op.date}</span>
                    {op.location && (
                      <span className="text-xs text-gray-500">{op.location}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {selectedOpportunity && (
        <OpportunityBidModal
          opportunity={selectedOpportunity}
          onClose={() => setSelectedOpportunity(null)}
        />
      )}
    </div>
  );
};

export default OpportunitiesPage;
