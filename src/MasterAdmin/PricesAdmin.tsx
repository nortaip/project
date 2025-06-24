import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function PricesAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [prices, setPrices] = useState<any[]>([]);
  const [aiPrice, setAiPrice] = useState<null | { average_min: number; average_max: number; description: string }>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => { fetchCategories(); }, []);
  useEffect(() => {
    if (category) {
      fetchSubcategories(category);
      fetchPrices(category);
    } else {
      setSubcategories([]);
      setPrices([]);
    }
  }, [category]);

  const fetchCategories = async () => {
    const { data, error } = await supabase.from("service_categories").select("*");
    if (!error) setCategories(data || []);
  };

  const fetchSubcategories = async (categoryId: string) => {
    const { data, error } = await supabase
      .from("service_subcategories")
      .select("*")
      .eq("category_id", categoryId);
    if (!error) setSubcategories(data || []);
  };

  const fetchPrices = async (categoryId: string) => {
    const { data, error } = await supabase
      .from("service_prices")
      .select("*, service_subcategories(label)")
      .eq("category_id", categoryId);
    if (!error) setPrices(data || []);
  };

  const handleAIFetch = async () => {
    setAiLoading(true);
    setAiPrice(null);
    const cat = categories.find(c => c.id === category);
    const subcat = subcategories.find(s => s.id === selectedSubcategoryId);
    if (!cat || !subcat) {
      alert("Əvvəlcə kateqoriya və növ seçin.");
      setAiLoading(false);
      return;
    }
    try {
      const res = await fetch('https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/ai-price-research', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category_label: cat.label,
          subcategory_label: subcat.label,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAiPrice(data.priceResult);
        setMinPrice(data.priceResult.average_min?.toString() || "");
        setMaxPrice(data.priceResult.average_max?.toString() || "");
      } else {
        setAiPrice(null);
        alert("AI qiyməti tapılmadı!");
      }
    } catch (err) {
      alert("AI bazar araşdırması alınmadı.");
      setAiPrice(null);
    }
    setAiLoading(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedSubcategory = subcategories.find(sc => sc.id === selectedSubcategoryId);
    if (!selectedSubcategory) return;

    const { error } = await supabase.from("service_prices").insert([
      {
        category_id: category,
        subcategory_id: selectedSubcategory.id,
        question_name: "Əlavə xidmət tipi",
        option_value: selectedSubcategory.label,
        min_price: Number(minPrice),
        max_price: Number(maxPrice),
      },
    ]);
    if (!error) {
      setSelectedSubcategoryId("");
      setMinPrice("");
      setMaxPrice("");
      fetchPrices(category);
      setAiPrice(null);
    }
  };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Qiymət İdarə Paneli</h2>

      <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-white p-4 rounded-lg shadow">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="">Kateqoriya seçin</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        <select
          value={selectedSubcategoryId}
          onChange={(e) => setSelectedSubcategoryId(e.target.value)}
          disabled={!category}
          className="p-2 border rounded"
        >
          <option value="">Növ seçin</option>
          {subcategories.map(sc => (
            <option key={sc.id} value={sc.id}>{sc.label}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Minimum"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className="p-2 border rounded"
        />

        <input
          type="number"
          placeholder="Maksimum"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className="p-2 border rounded"
        />

        {/* AI ilə qiymət tap düyməsi və nəticə göstər */}
        <div className="col-span-1 md:col-span-4 flex flex-col items-start">
          {subcategories.length > 0 && selectedSubcategoryId && (
            <button
              type="button"
              onClick={handleAIFetch}
              disabled={aiLoading}
              className="bg-green-600 text-white px-4 py-2 rounded mb-2"
            >
              {aiLoading ? "Yüklənir..." : "AI ilə bazar qiymətini tap"}
            </button>
          )}
          {aiPrice && (
            <div className="bg-indigo-50 border-l-4 border-indigo-400 p-4 mb-2">
              <b>AI Bazara görə qiymət:</b><br/>
              <span>Minimum: <b>{aiPrice.average_min} AZN</b></span><br/>
              <span>Maksimum: <b>{aiPrice.average_max} AZN</b></span><br/>
              <span className="text-xs text-gray-700">{aiPrice.description}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="col-span-1 md:col-span-4 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
        >
          Əlavə et
        </button>
      </form>

      {/* Price Table */}
      <div className="bg-white shadow rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">Mövcud qiymətlər</h3>
        {prices.length === 0 ? (
          <p className="text-gray-500">Heç bir qiymət tapılmadı.</p>
        ) : (
          <table className="w-full border text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2">Xidmət növü</th>
                <th className="border p-2">Min</th>
                <th className="border p-2">Max</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i}>
                  <td className="border p-2">{p.option_value}</td>
                  <td className="border p-2">{p.min_price} AZN</td>
                  <td className="border p-2">{p.max_price} AZN</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
