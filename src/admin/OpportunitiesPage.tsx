import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import OpportunityBidModal from "./OpportunityBidModal.tsx";
import { OpportunitiesInfoBanner } from "../components/OpportunitiesInfoBanner.tsx";
import { Alert } from "antd";

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
}

const OpportunitiesPage: React.FC = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [loading, setLoading] = useState(true);
  const [specialties, setSpecialties] = useState<string[]>([]);

  // Helper function to get category label by ID
  const getCategoryLabel = (id: string) => categories.find((c) => c.id === id)?.label || "";

  // Helper function to get subcategory label by ID
  const getSubcategoryLabel = (id: string) => subcategories.find((c) => c.id === id)?.label || "";

  // filtered opportunities after all data is loaded
  const filteredOpportunities = opportunities.filter((op) => {
    const categoryLabel = getCategoryLabel(op.category_id);
    return specialties.includes(categoryLabel);
  });

  useEffect(() => {
    const fetchUserSpecialties = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("specialties")
        .eq("id", user.id)
        .single();

      if (error) {
        console.error("Profil specialties alınarkən xəta:", error);
      } else if (data?.specialties) {
        setSpecialties(data.specialties);
      }
    };

    fetchUserSpecialties();
  }, []);

  useEffect(() => {
    const fetchStaticData = async () => {
      try {
        const { data: catData, error: catError } = await supabase.from("service_categories").select("*");
        if (catError) console.error("Error fetching categories:", catError);
        if (catData) setCategories(catData);

        const { data: subCatData, error: subCatError } = await supabase.from("service_subcategories").select("*");
        if (subCatError) console.error("Error fetching subcategories:", subCatError);
        if (subCatData) setSubcategories(subCatData);
      } catch (err) {
        console.error("Error fetching static data:", err);
      }
    };
    fetchStaticData();
  }, []);

  useEffect(() => {
    const fetchAndSubscribeOpportunities = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching opportunities:", error);
        setLoading(false);
        return;
      }

      setOpportunities(data as Opportunity[]);
      setLoading(false);

      const channel = supabase
        .channel("public:opportunities_channel")
        .on("postgres_changes", { event: "*", schema: "public", table: "opportunities" }, () => {
          fetchAndSubscribeOpportunities();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    fetchAndSubscribeOpportunities();
  }, []);

  const parseExtraAnswers = (jsonString: string) => {
    try {
      const obj = JSON.parse(jsonString || "{}");
      return Object.entries(obj);
    } catch (e) {
      console.warn("Could not parse extra_answers JSON:", jsonString, e);
      return [];
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-md">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Fürsətlər</h2>
      <OpportunitiesInfoBanner />
      {loading ? (
        <div className="text-center text-gray-600 p-4">Fürsətlər yüklənir...</div>
      ) : (
        <div className="space-y-4">
          {filteredOpportunities.length === 0 && (
            <div className="text-center text-gray-500 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <Alert
  message="Diqqət!"
  description="Fürsətləri görmək üçün kateqoriya və alt-kateqoriya seçin."
  type="warning"
  showIcon
  className="mb-5 rounded-lg"
/>
              <p>Hazırda seçdiyiniz kateqoriyaya uyğun fürsət yoxdur.</p>
              <p className="text-sm text-gray-400 mt-1">
                Qeyd: Fürsətlərin görünməsi sizin profilinizin səviyyəsi, reytinqiniz və sahə üzrə ixtisaslarınıza əsasən dəyişə bilər.
              </p>
            </div>
          )}

          {filteredOpportunities.map((op) => {
            const extra = parseExtraAnswers(op.extra_answers);

            return (
              <div key={op.id} className="bg-gray-50 p-5 rounded-lg shadow-sm flex flex-col gap-3 border border-gray-200">
                <p className="text-sm text-gray-400 mt-1">
                  Qeyd: Fürsətlərin görünməsi sizin profilinizin səviyyəsi, reytinqiniz və sahə üzrə ixtisaslarınıza əsasən dəyişə bilər.
                </p>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-lg text-gray-900">
                      {getCategoryLabel(op.category_id)}
                      {op.subcategory_id ? " / " + getSubcategoryLabel(op.subcategory_id) : ""}
                    </div>
                  </div>
                  {op.status === "completed" ? (
                    <span className="text-gray-500 font-semibold italic">
                      Tamamlandı, artıq təklif verilə bilməz
                    </span>
                  ) : (
                    <button
                      className="bg-indigo-600 text-white rounded-lg px-4 py-2 hover:bg-indigo-700 transition-colors shadow-md"
                      onClick={() => setSelectedOpportunity(op)}
                    >
                      Təklif ver
                    </button>
                  )}

                </div>
                <div className="flex flex-col gap-2">
                  {op.budget !== null && (
                    <div className="text-sm text-green-700 font-bold">
                      Təxmini büdcə: <span className="text-base">{op.budget} AZN</span>
                    </div>
                  )}
                  <div className="text-gray-800">{op.description}</div>
                  {extra.length > 0 && extra.some(([_, v]) => v && String(v).trim() !== "") ? (
                    <div className="bg-white border rounded p-3 mt-2">
                      <div className="font-medium text-gray-700 mb-1 text-sm">Əlavə suallar və cavablar:</div>
                      <ul className="text-sm space-y-1 text-gray-800">
                        {extra
                          .filter(([_, v]) => v && String(v).trim() !== "")
                          .map(([k, v]) => (
                            <li key={k} className="flex items-start">
                              <span className="font-medium capitalize mr-1">{k.replace(/_/g, " ")}:</span>
                              <span className="flex-1">{String(v)}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 mt-2">Əlavə suallar yoxdur</div>
                  )}
                  <div className="flex flex-row justify-between items-center mt-2">
                    <span className="text-xs text-gray-500">
                      Son tarix:{" "}
                      {new Date(op.date).toLocaleDateString("az-AZ", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    {op.location && (
                      <span className="text-xs text-gray-600 flex items-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4 mr-1 text-gray-400"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {op.location}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
