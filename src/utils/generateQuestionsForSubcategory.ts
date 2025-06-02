import OpenAI from "openai";

// Bura API key frontend-də təhlükəlidir! (Təhlükəsizlik üçün bunu serverdə saxla!)
const openai = new OpenAI({
    apiKey: "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",
    dangerouslyAllowBrowser: true,
});

export async function generateQuestionsForSubcategory(subcategoryLabel: string) {
    const prompt = `
Sən bir xidmət platforması üçün istifadəçi sifarişi formu hazırlayırsan.
Kateqoriya: "${subcategoryLabel}"
Aşağıdakı formatda, bu xidmətə sifariş vermək üçün lazım olan ən faydalı və peşəkar sualları (label, type, name, options əgər varsa) JSON array olaraq qaytar:
Example:
[
  { "label": "Avtomobil markası və modeli", "type": "text", "name": "car_model" },
  { "label": "Təcili xidmət lazımdır?", "type": "select", "name": "urgent", "options": ["Bəli", "Xeyr"] }
]
Aydın və dolğun suallar olsun, say az olsun, lakin mütəxəssis üçün kifayət qədər məlumat toplasın.
`;

    const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4o", // və ya "gpt-3.5-turbo"
        messages: [
            { role: "user", content: prompt }
        ],
        temperature: 0.2,
    });

    const jsonStr = chatCompletion.choices[0].message.content || "[]";
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        return [];
    }
}
