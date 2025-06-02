import React, { useState, useEffect, useMemo } from "react";
import InputMask from "react-input-mask";
import { supabase } from "../lib/supabase";

const steps = ["Kateqoriya", "Məlumat", "Təsdiq"];

const DynamicServiceForm: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [servicePrices, setServicePrices] = useState<any[]>([]);
  const [category, setCategory] = useState<string>("");
  const [subcategory, setSubcategory] = useState<string>("");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [phoneError, setPhoneError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string>("");

  // Kateqoriya/subkateqoriya/suallar/qiymətlər yüklə
  useEffect(() => {
    supabase.from("service_categories").select("*").then(({ data }) => setCategories(data || []));
  }, []);
  useEffect(() => {
    if (category) {
      supabase.from("service_subcategories").select("*").eq("category_id", category)
        .then(({ data }) => setSubcategories(data || []));
      setSubcategory("");
      setQuestions([]);
      setServicePrices([]);
      setAnswers({});
    }
  }, [category]);
  useEffect(() => {
    if (subcategory) {
      supabase
        .from("service_questions")
        .select("*")
        .eq("category_id", category)
        .order("order_num", { ascending: true })
        .then(({ data }) => setQuestions(data || []));
      supabase
        .from("service_prices")
        .select("*")
        .eq("category_id", category)
        .then(({ data }) => setServicePrices(data || []));
      setAnswers({});
    } else {
      setQuestions([]);
      setAnswers({});
      setServicePrices([]);
    }
  }, [subcategory, category]);

  // Dinamik qiymət aralığı hesablayıcı
  const priceInfo = useMemo(() => {
    if (!servicePrices.length) return null;
    let min = 0, max = 0;

    for (const q of questions) {
      const ans = answers[q.name];
      if (ans) {
        // Tap sual+option-a uyğun qiyməti
        const priceRow = servicePrices.find(
          (sp: any) => sp.question_name === q.name && sp.option_value == ans
        );
        if (priceRow) {
          min += Number(priceRow.min_price) || 0;
          max += Number(priceRow.max_price) || 0;
        }
      }
    }
    if (min === 0 && max === 0) return null;
    return { min, max };
  }, [answers, questions, servicePrices]);

  // Input dəyişəndə cavabları yenilə
  const handleChange = (name: string, value: any) => {
    if (name === "phone") {
      const raw = value.replace(/\D/g, "");
      if (raw.length === 12 && value.startsWith("+994")) setPhoneError("");
      else setPhoneError("Əlaqə nömrəsi düzgün formatda deyil: +994xxxxxxxxx");
    }
    setAnswers((prev) => ({ ...prev, [name]: value }));
  };

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 0));

  // Göndər
  const handleSend = async () => {
    if (!phoneError && !questions.some((q: any) => !answers[q.name])) {
      setLoading(true);
      setError("");
      setSuccess(false);
      const { error } = await supabase.from("opportunities").insert([{
        title: answers.title || "Xidmət sorğusu",
        description: answers.description || "",
        created_by: (await supabase.auth.getUser()).data.user?.id,
        date: answers.date || new Date().toISOString().substring(0, 10),
        location: answers.location || "",
        category_id: category,
        subcategory_id: subcategory,
        budget: priceInfo ? priceInfo.max : (answers.budget ? Number(answers.budget) : null),
        extra_answers: JSON.stringify(answers),
      }]);
      setLoading(false);
      if (error) setError("Xəta baş verdi: " + error.message);
      else {
        setSuccess(true);
        setCurrentStep(0);
        setCategory("");
        setSubcategory("");
        setAnswers({});
        setTimeout(() => setSuccess(false), 2500);
      }
    }
  };

  // Input renderer
  const renderInput = (q: any) => {
    let optionsArr: string[] = [];
    if (typeof q.options === "string") {
      try { optionsArr = JSON.parse(q.options); } catch { optionsArr = []; }
    } else if (Array.isArray(q.options)) {
      optionsArr = q.options;
    }

    if (q.type === "select" && optionsArr.length) {
      return (
        <select
          className="border p-2 rounded w-full"
          value={answers[q.name] || ""}
          onChange={e => handleChange(q.name, e.target.value)}
        >
          <option value="">Seçin</option>
          {optionsArr.map((opt: string) => (
            <option value={opt} key={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (q.type === "textarea") {
      return (
        <textarea
          className="border p-2 rounded w-full"
          value={answers[q.name] || ""}
          onChange={e => handleChange(q.name, e.target.value)}
        />
      );
    }
    if (q.type === "tel") {
      return (
        <InputMask
          mask="+994999999999"
          maskChar=""
          value={answers[q.name] || ""}
          onChange={e => handleChange(q.name, e.target.value)}
          className="border p-2 rounded w-full"
          placeholder="+994xxxxxxxxx"
        />
      );
    }
    return (
      <input
        type={q.type}
        className="border p-2 rounded w-full"
        value={answers[q.name] || ""}
        onChange={e => handleChange(q.name, e.target.value)}
      />
    );
  };

  // Step göstəricisi
  const StepIndicator = () => (
    <div className="flex justify-between mb-8">
      {steps.map((s, i) => (
        <div key={s} className={`flex-1 text-center font-semibold ${currentStep === i ? "text-indigo-600" : "text-gray-400"}`}>
          <div className={`w-8 h-8 mx-auto mb-1 rounded-full flex items-center justify-center ${currentStep === i ? "bg-indigo-600 text-white" : "bg-gray-200"}`}>
            {i + 1}
          </div>
          <div className="text-xs">{s}</div>
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={e => e.preventDefault()} className="max-w-xl mx-auto mt-10 bg-white rounded-2xl shadow-lg p-8">
      <StepIndicator />

      {/* 1. Kateqoriya seçimi */}
      {currentStep === 0 && (
        <div>
          <label className="block font-semibold mb-2 text-lg">Kateqoriya seçin</label>
          <select
            className="border p-2 rounded w-full"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option value="">Kateqoriyanı seçin</option>
            {categories.map((cat) => (
              <option value={cat.id} key={cat.id}>{cat.label}</option>
            ))}
          </select>
          {category && (
            <div className="mt-4">
              <label className="block font-semibold mb-2">Alt kateqoriya seçin</label>
              <select
                className="border p-2 rounded w-full"
                value={subcategory}
                onChange={e => setSubcategory(e.target.value)}
              >
                <option value="">Alt kateqoriyanı seçin</option>
                {subcategories.map((sub) => (
                  <option value={sub.id} key={sub.id}>{sub.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end mt-6">
            <button
              type="button"
              className="bg-indigo-600 text-white px-6 py-2 rounded shadow transition hover:bg-indigo-700 disabled:bg-gray-300"
              onClick={nextStep}
              disabled={!category || !subcategory}
            >
              Növbəti
            </button>
          </div>
        </div>
      )}

      {/* 2. Suallar və qiymət aralığı */}
      {currentStep === 1 && (
        <div>
          {/* Qiymət aralığı */}
          {priceInfo && (
            <div className="my-4 px-3 py-2 rounded bg-indigo-50 border border-indigo-100">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Aktual qiymət aralığı:</span>
                <span className="font-semibold text-indigo-700">{priceInfo.min} – {priceInfo.max} AZN</span>
              </div>
              <div className="w-full h-1 rounded bg-gray-200 mt-2">
                <div className="h-1 bg-green-400 rounded" style={{ width: '80%' }} />
              </div>
            </div>
          )}
          {questions.length === 0 && (
            <div className="my-4 text-gray-500 text-center">Bu alt kateqoriya üçün suallar tapılmadı.</div>
          )}
          {questions.map((q) => (
            <div key={q.name} className="mb-5">
              <label className="block font-medium mb-1">
                {q.label || q.question}
              </label>
              {renderInput(q)}
              {q.type === "tel" && phoneError && (
                <div className="text-red-600 text-xs mt-1">{phoneError}</div>
              )}
            </div>
          ))}

          <div className="flex justify-between mt-6">
            <button type="button" className="bg-gray-100 text-gray-800 px-6 py-2 rounded shadow" onClick={prevStep}>Geri</button>
            <button
              type="button"
              className="bg-indigo-600 text-white px-8 py-2 rounded shadow transition hover:bg-indigo-700"
              onClick={nextStep}
              disabled={questions.some((q: any) => !answers[q.name]) || !!phoneError}
            >
              Növbəti
            </button>
          </div>
        </div>
      )}

      {/* 3. Təsdiqlə */}
      {currentStep === 2 && (
        <div>
          <h3 className="text-lg font-semibold mb-4 text-center text-indigo-700">Təsdiqləmə</h3>
          <div className="space-y-2 mb-6">
            <div>
              <span className="font-medium">Kateqoriya:</span> {categories.find((c) => c.id === category)?.label}
            </div>
            <div>
              <span className="font-medium">Alt kateqoriya:</span> {subcategories.find((s) => s.id === subcategory)?.label}
            </div>
            {questions.map((q: any) => (
              <div key={q.name}>
                <span className="font-medium">{q.label || q.question}:</span> {answers[q.name]}
              </div>
            ))}
            {priceInfo && (
              <div className="font-medium text-green-700 text-base pt-2">
                Son qiymət aralığı: <span className="font-bold">{priceInfo.min} – {priceInfo.max} AZN</span>
              </div>
            )}
          </div>
          {success && (
            <div className="text-green-600 mb-2 text-center">Uğurla göndərildi!</div>
          )}
          {error && (
            <div className="text-red-600 mb-2 text-center">{error}</div>
          )}
          <div className="flex justify-between mt-6">
            <button
              type="button"
              className="bg-gray-100 text-gray-800 px-6 py-2 rounded shadow"
              onClick={prevStep}
            >
              Geri
            </button>
            <button
              type="button"
              className="bg-green-600 text-white px-8 py-2 rounded shadow transition hover:bg-green-700"
              disabled={
                !category ||
                questions.some((q: any) => !answers[q.name]) ||
                !!phoneError ||
                loading
              }
              onClick={handleSend}
            >
              {loading ? "Göndərilir..." : "Təsdiqlə və göndər"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
};

export default DynamicServiceForm;
