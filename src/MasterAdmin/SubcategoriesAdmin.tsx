import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function SubcategoriesAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [subcategories, setSubcategories] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);

  useEffect(() => {
    if (category) {
      supabase
        .from("service_subcategories")
        .select("*")
        .eq("category_id", category)
        .then(({ data }) => setSubcategories(data || []));
    }
  }, [category]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !label) return;
    await supabase.from("service_subcategories").insert([{ category_id: category, label }]);
    setLabel("");
    supabase.from("service_subcategories").select("*").eq("category_id", category).then(({ data }) => setSubcategories(data || []));
  };

  return (
    <div>
      <h2 className="font-bold text-xl mb-4">Alt kateqoriyalar</h2>
      <form className="mb-6 flex gap-2 items-center" onSubmit={handleAdd}>
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
          className="border p-2 rounded flex-1"
          placeholder="Alt kateqoriya adı (məs: Evakuator xidməti)"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={!category || !label}>
          Əlavə et
        </button>
      </form>
      <div className="text-xs text-gray-500 mb-4">
        **Əvvəlcə kateqoriya seç, sonra alt kateqoriya əlavə et.**
      </div>
      <ul>
        {subcategories.map(sub => (
          <li key={sub.id} className="border-b py-2">{sub.label}</li>
        ))}
      </ul>
    </div>
  );
}
