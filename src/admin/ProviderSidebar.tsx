import React from "react";
import { NavLink } from "react-router-dom";
import { Briefcase, FileText, Trophy, List, DollarSign } from "lucide-react";

const items = [
  { to: "/profile/admin/opportunities", label: "İmkanlarım", icon: <Briefcase size={18} /> },
  { to: "/profile/admin/offers", label: "Təkliflərim", icon: <FileText size={18} /> },
  { to: "/profile/admin/won", label: "Qazandıqlarım", icon: <Trophy size={18} /> },
  { to: "/profile/admin/services", label: "Xidmətlərim", icon: <List size={18} /> },
  { to: "/profile/admin/balance", label: "Balans", icon: <DollarSign size={18} /> },
];

const ProviderSidebar: React.FC = () => (
  <aside className="w-60 bg-white border-r p-6">
    <div className="font-bold text-xl mb-8">Armut Panel</div>
    <nav className="flex flex-col gap-2">
      {items.map(item => (
        <NavLink
          to={item.to}
          key={item.to}
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2 rounded transition-colors ${isActive ? "bg-indigo-100 text-indigo-700 font-bold" : "hover:bg-gray-100 text-gray-700"}`
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
    </nav>
  </aside>
);

export default ProviderSidebar;
