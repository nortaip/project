import React, { useState } from "react";
import CategoriesAdmin from "./CategoriesAdmin";
import SubcategoriesAdmin from "./SubcategoriesAdmin";
import QuestionsAdmin from "./QuestionsAdmin";
import PricesAdmin from "./PricesAdmin";
// ... digər admin hissələrini də əlavə edə bilərsən

const menu = [
  { key: "categories", label: "Kateqoriyalar" },
  { key: "subcategories", label: "Alt kateqoriyalar" },
  { key: "questions", label: "Suallar" },
  { key: "prices", label: "Qiymətlər" },
  // ... əlavə bölmələr
];

export default function AdminPanel() {
  const [section, setSection] = useState("categories");

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white shadow-lg p-4 flex flex-col gap-2">
        <div className="font-bold text-xl mb-4 text-indigo-700">Admin Panel</div>
        {menu.map(item => (
          <button
            key={item.key}
            onClick={() => setSection(item.key)}
            className={`px-3 py-2 text-left rounded hover:bg-indigo-100 ${section === item.key ? "bg-indigo-50 font-semibold text-indigo-700" : "text-gray-700"}`}
          >
            {item.label}
          </button>
        ))}
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8">
        {section === "categories" && <CategoriesAdmin />}
        {section === "subcategories" && <SubcategoriesAdmin />}
        {section === "questions" && <QuestionsAdmin />}
        {section === "prices" && <PricesAdmin />}
        {/* əlavə bölmələr */}
      </main>
    </div>
  );
}
