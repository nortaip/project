import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Briefcase,
  FileText,
  Trophy,
  List, // Adətən "List" ikonu ümumi listlər üçün istifadə olunur
  DollarSign,
  LogOut,
  User, // Profil üçün daha uyğun ola bilər
  Settings, // Ayarlar üçün, əgər Profil 'Ayarlar' kimidirsə
} from "lucide-react"; // Lazım olan ikonları burdan import edin
import { signOut } from "../store/userauth"; // Supabase signOut funksiyanızın yolu

interface ProviderSidebarProps {
  userRole: string | null; // İstifadəçinin rolunu bir prop olaraq qəbul edir
}

const ProviderSidebar: React.FC<ProviderSidebarProps> = ({ userRole }) => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Sidebar elementləri və onların tələb olunan rolları
  const items = [
    { to: "/profile/opportunities", label: "İmkanlarım", icon: <Briefcase size={18} />, requiredRole: "provider" },
    { to: "/profile/offers", label: "Təkliflərim", icon: <FileText size={18} />, requiredRole: "provider" },
    { to: "/profile/won", label: "Qazandıqlarım", icon: <Trophy size={18} />, requiredRole: "provider" },
    { to: "/profile/services", label: "Xidmətlərim", icon: <List size={18} />, requiredRole: "provider" }, // Xidmətlər adətən provider üçündür
    { to: "/profile/main", label: "Profil", icon: <User size={18} /> }, // Profil üçün daha məntiqli ikon
    { to: "/profile/balance", label: "Balans", icon: <DollarSign size={18} /> },
  ];

  // Çıxış funksiyası
  const handleSignOut = async () => {
    try {
      await signOut(); // İstifadəçini sistemdən çıxar
      navigate('/login'); // Uğurlu çıxışdan sonra giriş səhifəsinə yönləndir
    } catch (error) {
      console.error("Çıxış zamanı xəta:", error); // Xətanı konsola yaz
      setError('Çıxış zamanı xəta baş verdi. Zəhmət olmasa, yenidən cəhd edin.'); // İstifadəçiyə mesaj göstər
    }
  };

  return (
    <aside className="w-64 p-4 bg-white shadow rounded-xl">
      <nav className="flex flex-col gap-2">
        {items.map((item) => {
          // Elementi yalnız istifadəçinin rolu uyğun gələrsə render et
          if (item.requiredRole && item.requiredRole !== userRole) {
            return null; // Tələb olunan rol yoxdursa elementi render etmə
          }
          return (
            <NavLink
              to={item.to}
              key={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 p-2 rounded transition-colors duration-200 ${
                  isActive ? 'bg-blue-100 text-blue-700 font-semibold' : 'hover:bg-gray-100 text-gray-700'
                }`
              }
              end={item.to === "/profile/main"} // Ana profil səhifəsi üçün 'end' propu əlavə et
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        {/* Çıxış düyməsi */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 p-2 rounded text-red-500 hover:bg-red-100 transition-colors duration-200"
        >
          <LogOut size={18} />
          Çıxış et
        </button>
        {/* Xəta mesajı */}
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </nav>
    </aside>
  );
};

export default ProviderSidebar;