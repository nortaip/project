import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const exampleNames = [
  "car_model_year", "phone", "service_type", "repair_type", "description", "budget"
];

interface Question {
  id: number;
  category_id: string;
  label: string;
  name: string;
  type: string;
  options: string[] | null;
}

export default function QuestionsAdmin() {
  const [categories, setCategories] = useState<any[]>([]);
  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [options, setOptions] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editId, setEditId] = useState<number | null>(null);

  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);

  useEffect(() => {
    if (category) {
      fetchQuestions();
    }
  }, [category]);

  const fetchQuestions = async () => {
    if (!category || !subcategory) {
      setQuestions([]);
      return;
    }
    const { data } = await supabase
      .from("service_questions")
      .select("*")
      .eq("category_id", category)
      .eq("subcategory_id", subcategory); // <-- Əlavə!
    setQuestions(data || []);
  };
  

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      category_id: category,
      label,
      name,
      type,
      options: options ? JSON.stringify(options.split(",").map(opt => opt.trim())) : null,
    };

    if (editId) {
      await supabase.from("service_questions").update(payload).eq("id", editId);
    } else {
      await supabase.from("service_questions").insert([payload]);
    }

    resetForm();
    fetchQuestions();
  };

  const resetForm = () => {
    setLabel("");
    setName("");
    setType("text");
    setOptions("");
    setEditId(null);
  };

  const handleEdit = (q: Question) => {
    setEditId(q.id);
    setLabel(q.label);
    setName(q.name);
    setType(q.type);
    setOptions(q.options ? q.options.join(", ") : "");
  };

  const handleDelete = async (id: number) => {
    if (confirm("Bu sualı silmək istədiyinizə əminsiniz?")) {
      await supabase.from("service_questions").delete().eq("id", id);
      fetchQuestions();
    }
  };
  const [aiGenerating, setAIGenerating] = useState(false);
  const generateAIQuestions = async () => {
    if (!category) {
      alert("Zəhmət olmasa kateqoriya seçin.");
      return;
    }
    if (!subcategory) {
      alert("Zəhmət olmasa alt kateqoriya seçin.");
      return;
    }
    const selectedCat = categories.find(c => c.id === category);
    const selectedSubcat = subcategories.find(s => s.id === subcategory);
    if (!selectedCat || !selectedSubcat) return;

    setAIGenerating(true);

    try {
      const res = await fetch("https://fvvxtnjfjtqrhpecsvpd.supabase.co/functions/v1/ai-question-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: selectedCat.id,
          category_label: selectedCat.label,
          subcategory_id: selectedSubcat.id,
          subcategory_label: selectedSubcat.label,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        alert(`${data.count} AI sualı əlavə olundu`);
        fetchQuestions();
      } else {
        console.error(data);
        alert("AI sualları əlavə olunmadı.");
      }
    } catch (err) {
      console.error(err);
      alert("GPT xidmətinə qoşulmaq mümkün olmadı.");
    } finally {
      setAIGenerating(false);
    }
  };

  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [subcategory, setSubcategory] = useState("");
  
  useEffect(() => {
    if (!category) {
      setSubcategories([]);
      setSubcategory("");
      return;
    }
    supabase
      .from("service_subcategories")
      .select("*")
      .eq("category_id", category)
      .then(({ data }) => setSubcategories(data || []));
    setSubcategory("");
  }, [category]);
  useEffect(() => {
    fetchQuestions();
  }, [category, subcategory]);
  return (
    <div>
      <h2 className="font-bold text-xl mb-4">Suallar</h2>
      <form className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-2 items-end" onSubmit={handleSubmit}>
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
        <select
          className="border p-2 rounded"
          value={subcategory}
          onChange={e => setSubcategory(e.target.value)}
          disabled={!category}
        >
          <option value="">Alt kateqoriya seç</option>
          {subcategories.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <input
          type="text"
          className="border p-2 rounded"
          placeholder="Başlıq"
          value={label}
          onChange={e => setLabel(e.target.value)}
        />
        <input
          type="text"
          className="border p-2 rounded"
          placeholder="Name"
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
          placeholder="Options (vergül ilə)"
          value={options}
          onChange={e => setOptions(e.target.value)}
        />
        {category && (
          <div className="mb-4">
            <button
              onClick={generateAIQuestions}
              disabled={aiGenerating}
              className="bg-green-600 text-white px-4 py-2 rounded"
            >
              {aiGenerating ? "Yaradılır..." : "AI ilə sual yarat"}
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded" disabled={!category || !label || !name}>
            {editId ? "Yadda saxla" : "Əlavə et"}
          </button>
          {editId && (
            <button type="button" onClick={resetForm} className="bg-gray-400 text-white px-4 py-2 rounded">
              Ləğv et
            </button>
          )}
        </div>
      </form>

      <div className="text-xs text-gray-500 mb-4">
        <b>Sualın name-i texniki açardır:</b> məsələn, <i>car_model_year, phone, service_type, repair_type</i>. <br />
        <b>Type</b> - input növüdür. <br />
        <b>Options</b> (yalnız <i>select</i> üçün, vergül ilə ayır): məsələn <i>Bəli, Xeyr</i>
      </div>

      <ul className="space-y-2">
        {questions.map(q => (
          <li key={q.id} className="border-b py-2 flex justify-between items-center">
            <div>
              <b>{q.label}</b> <span className="text-gray-500">({q.name})</span>
            </div>
            <div className="space-x-2">
              <button onClick={() => handleEdit(q)} className="text-blue-600 hover:underline">Redaktə et</button>
              <button onClick={() => handleDelete(q.id)} className="text-red-600 hover:underline">Sil</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
