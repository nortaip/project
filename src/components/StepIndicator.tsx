// components/StepIndicator.tsx
import React from "react";

export const StepIndicator = ({ steps, current }: { steps: string[]; current: number }) => (
  <div className="flex items-center justify-center mb-8 gap-4">
    {steps.map((step, i) => (
      <div key={i} className="flex items-center">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold
            ${i === current ? "bg-indigo-600" : "bg-gray-300"}`}
        >
          {i + 1}
        </div>
        <div className={`ml-2 mr-4 text-sm ${i === current ? "font-semibold text-indigo-600" : "text-gray-600"}`}>{step}</div>
        {i !== steps.length - 1 && <div className="w-6 h-1 bg-gray-200 rounded-full" />}
      </div>
    ))}
  </div>
);
