// ✅ REACT DROPDOWN COMPONENT FOR CATEGORY & SUBCATEGORY FILTER
import React from 'react';

interface CategoryDropdownProps {
  categories: { name: string; subcategories: string[] }[];
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
}

const CategoryDropdown: React.FC<CategoryDropdownProps> = ({ categories, selectedCategory, setSelectedCategory }) => {
  return (
    <div className="space-y-1">
      <button
        onClick={() => setSelectedCategory('all')}
        className={`w-full text-left px-4 py-2 rounded-lg text-sm ${
          selectedCategory === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        Bütün kateqoriyalar
      </button>

      {categories.map(category => (
        <div key={category.name} className="space-y-1">
          <button
            onClick={() => setSelectedCategory(category.name)}
            className={`w-full text-left font-medium px-4 py-2 rounded-lg text-sm ${
              selectedCategory === category.name ? 'bg-indigo-100 text-indigo-700' : 'text-gray-800 hover:bg-gray-100'
            }`}
          >
            {category.name}
          </button>
          <div className="ml-4 space-y-1">
            {category.subcategories.map(sub => (
              <button
                key={sub}
                onClick={() => setSelectedCategory(sub)}
                className={`w-full text-left px-4 py-1 rounded-md text-sm ${
                  selectedCategory === sub ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                - {sub}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CategoryDropdown;
