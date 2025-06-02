import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const exampleNames = [
  "car_model_year", "phone", "service_type", "repair_type", "description", "budget"
];

export default function QuestionsAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);

  useEffect(() => {
    if (category) {
      supabase.from("service_questions").select("*").eq("category_id", category).then(({ data }) => setQuestions(data || []));
    }
  }, [category]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await supabase.from("service_questions").insert([{
      category_id: category,
      label,
      name,
      type,
      options: options ? JSON.stringify(options.split(",").map(opt => opt.trim())) : null
    }]);
    setLabel(""); setName(""); setType("text"); setOptions("");
    supabase.from("service_questions").select("*").eq("category_id", category).then(({ data }) => setQuestions(data || []));
  };

  return (
    <div>
      <h2 className="font-bold text-xl mb-4">Suallar</h2>
      <form className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-2 items-end" onSubmit={handleAdd}>
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
          placeholder="Başlıq (məs: Avtomobil markası və ili)"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <input
          type="text"
          className="border p-2 rounded"
          placeholder="Name (məs: phone)"
          value={name}
          onChange={e => setName(e.target.value)}
          list="example-names"
        />
        <datalist id="example-names">
          {exampleNames.map(en => <option key={en} value={en} />)}
        </datalist>
        <select className="border p-2 rounded" value={type} onChange={e => setType(e.target.value)}>
          <option value="text">Text</option>
          <option value="select">Select</option>
          <option value="textarea">Textarea</option>
          <option value="tel">Telefon</option>
          <option value="date">Tarix</option>
        </select>
        <input
          type="text"
          className="border p-2 rounded"
          placeholder='Options (məs: "Bəli, Xeyr")'
          value={options}
          onChange={e => setOptions(e.target.value)}
        />
        <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={!category || !label || !name}>
          Əlavə et
        </button>
      </form>
      <div className="text-xs text-gray-500 mb-4">
        <b>Sualın name-i texniki açardır:</b> məsələn, <i>car_model_year, phone, service_type, repair_type</i>. Mövcudlardan seç və ya yenisini yaz. <br />
        <b>Type</b> - input növüdür. <br />
        <b>Options</b> (yalnız <i>select</i> üçün, vergül ilə ayır): məsələn <i>Bəli, Xeyr</i>
      </div>
      <ul>
        {questions.map(q => (
          <li key={q.id} className="border-b py-2">{q.label} ({q.name})</li>
        ))}
      </ul>
    </div>
  );
}
