// generateQuestions.js

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

// Supabase bağlantısı
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// GPT üçün prompt generator
const generatePrompt = (categoryName) => `
Aşağıdakı kateqoriya üçün istifadəçidən soruşulacaq 5–7 sual hazırla.
Hər bir sual bu formatda olsun:
{
  "name": "unikal_ad",
  "question": "Sualın mətnini yaz",
  "type": "select | text | number | date | tel | textarea",
  "options": ["Əgər select-disə variantlar yaz"],
  "required": true
}
Nəticəni JSON array şəklində qaytar. Başqa heç nə yazma.

Kateqoriya: "${categoryName}"
`;

// OpenAI API çağırışı
async function getQuestionsFromGPT(categoryName) {
  const prompt = generatePrompt(categoryName);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });

  const json = await res.json();
  try {
    const raw = json.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error("Cavab parse olunmadı:", err, json);
    return null;
  }
}

// Supabase-ə yaz
async function insertQuestionsToSupabase(category_id, questions) {
  const records = questions.map((q, index) => ({
    category_id,
    name: q.name,
    question: q.question,
    type: q.type,
    options: q.options?.length ? JSON.stringify(q.options) : null,
    required: q.required,
    order_num: index + 1,
  }));

  const { error } = await supabase.from("service_questions").insert(records);
  if (error) {
    console.error("Yazarkən xəta:", error.message);
  } else {
    console.log("Suallar uğurla əlavə olundu.");
  }
}

// Əsas funksiyanı işə sal
(async () => {
  const categoryName = process.argv[2]; // terminaldan alınır
  const category_id = process.argv[3]; // Supabase ID

  if (!categoryName || !category_id) {
    console.error("İstifadə: node generateQuestions.js 'Kateqoriya adı' 'category_id'");
    process.exit(1);
  }

  const questions = await getQuestionsFromGPT(categoryName);
  if (questions) {
    await insertQuestionsToSupabase(category_id, questions);
  }
})();
