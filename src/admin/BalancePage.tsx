import React from "react";

const BalancePage: React.FC = () => {
  // Burada istifadəçinin balansını Supabase-dən fetch et (demo üçün sadə göstərilir)
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Balansım</h2>
      <div className="bg-white p-6 rounded shadow flex flex-col gap-3">
        <div className="text-4xl font-bold text-indigo-700">0 ₼</div>
        <div className="text-sm text-gray-500">Yükləmə və balans tarixçəsi tezliklə burada olacaq.</div>
      </div>
    </div>
  );
};

export default BalancePage;
