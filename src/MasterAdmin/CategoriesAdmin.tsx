import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function CategoriesAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchCategories = async () => {
    const { data } = await supabase.from("service_categories").select("*").order("label");
    setCategories(data || []);
  };

  useEffect(() => { fetchCategories(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await supabase.from("service_categories").insert([{ label }]);
    setLabel("");
    fetchCategories();
    setLoading(false);
  };

  return (
    <div>
      <h2 className="font-bold text-xl mb-4">Kateqoriyalar</h2>
      <form className="mb-6 flex gap-2" onSubmit={handleAdd}>
        <input
          type="text"
          className="border p-2 rounded flex-1"
          placeholder="Kateqoriya adı (məs: Avtomobil xidmətləri)"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={loading || !label}>
          Əlavə et
        </button>
      </form>
      <div className="text-xs text-gray-500 mb-4">
        **Kateqoriya adı istifadəçiyə görünəcək başlıqdır. Məsələn, "Avtomobil xidmətləri".**
      </div>
      <ul>
        {categories.map(c => (
          <li key={c.id} className="border-b py-2">{c.label}</li>
        ))}
      </ul>
    </div>
  );
}
