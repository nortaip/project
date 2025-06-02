import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function PricesAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [prices, setPrices] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);

  useEffect(() => {
    if (category) {
      supabase.from("service_prices").select("*").eq("category_id", category).then(({ data }) => setPrices(data || []));
    }
  }, [category]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from("service_prices").insert([{
      category_id: category,
      service_type: serviceType,
      min_price: Number(minPrice),
      max_price: Number(maxPrice)
    }]);
    setServiceType(""); setMinPrice(""); setMaxPrice("");
    supabase.from("service_prices").select("*").eq("category_id", category).then(({ data }) => setPrices(data || []));
  };

  return (
    <div>
      <h2 className="font-bold text-xl mb-4">Qiymətlər</h2>
      <form className="mb-6 flex gap-2 items-end" onSubmit={handleAdd}>
        <select
          className="border p-2 rounded"
          value={category}
          onChange={e => setCategory(e.target.value)}
        >
          <option value="">Kateqoriya seç</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <input
          type="text"
          className="border p-2 rounded"
          placeholder="Növ (məs: Evakuator, Elektrik...)"
          value={serviceType}
          onChange={e => setServiceType(e.target.value)}
        />
        <input
          type="number"
          className="border p-2 rounded"
          placeholder="Min"
          value={minPrice}
          onChange={e => setMinPrice(e.target.value)}
        />
        <input
          type="number"
          className="border p-2 rounded"
          placeholder="Max"
          value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
        />
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={!category || !serviceType || !minPrice || !maxPrice}>
          Əlavə et
        </button>
      </form>
      <div className="text-xs text-gray-500 mb-4">
        Qiymət əlavə edərkən həm minimum, həm maksimum dəyəri yaz.
      </div>
      <ul>
        {prices.map(pr => (
          <li key={pr.id} className="border-b py-2">
            {pr.service_type}: {pr.min_price}–{pr.max_price} AZN
          </li>
        ))}
      </ul>
    </div>
  );
}
