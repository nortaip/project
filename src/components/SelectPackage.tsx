import React, { useState } from 'react';

interface Package {
  id: string;
  name: string;
}

interface SelectPackageProps {
  packages: Package[];
  onSelect: (selectedPackage: Package | null) => void;
}

const SelectPackage: React.FC<SelectPackageProps> = ({ packages, onSelect }) => {
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

  const handleSelect = (packageId: string) => {
    setSelectedPackageId(packageId);
    const selectedPackage = packages.find(pkg => pkg.id === packageId) || null;
    onSelect(selectedPackage);
  };

  return (
    <div className="relative">
      <select
        className="block w-full border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
        value={selectedPackageId || ''}
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="" disabled>Select a package</option>
        {packages.map(pkg => (
          <option
            key={pkg.id}
            value={pkg.id}
            className={`${
              selectedPackageId === pkg.id ? 'bg-indigo-600 text-white' : 'bg-white text-black'
            }`}
          >
            {pkg.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SelectPackage; 