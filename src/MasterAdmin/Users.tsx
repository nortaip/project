import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// User tipi tanımı (Sizdəki `profiles` cədvəlinə uyğunlaşdırın)
interface UserProfile {
  id: string;
  email: string;
  password_hash?: string; // Parol hash-i, Supabase auth-dan gəlməyəcək, amma biz dəyişdirmək üçün lazım ola bilər
  name: string; // Ad
  role: string; // İstifadəçi rolu (məsələn: 'admin', 'provider', 'user')
  phone_number?: string; // Telefon nömrəsi, optional ola bilər
  address?: string; // Adres
  birth_date?: string; // Doğum tarixi
  company_name?: string;
  experience_years?: number;
  specialties?: string[];
  status?: string;
  created_at: string; // Qeydiyyat tarixi
  updated_at: string;
  balance?: number;
  is_verified?: boolean;
  avatar_url?: string;
  settings?: object;
  rating?: number;
  bonus_balance?: number;
  total_bonus_earned?: number;
}

const UsersAdmin: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>(""); // Axtarış üçün state
  const [filterRole, setFilterRole] = useState<string>("all"); // Rol üzrə filtr üçün state
  const [filterById, setFilterById] = useState<string>(""); // YENI: ID üzrə filtr üçün state

  // Redaktə üçün state-lər
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editFormData, setEditFormData] = useState<Partial<UserProfile>>({}); // Form üçün data
  const [newPassword, setNewPassword] = useState<string>(""); // Parol yeniləmə üçün
  const [passwordConfirm, setPasswordConfirm] = useState<string>(""); // Parol təsdiqləmə

  // İstifadəçiləri Supabase-dən çəkmək üçün funksiya
  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
  
    try {
      let baseQuery = supabase.from("profiles").select("*");
  
      if (filterRole !== "all") {
        baseQuery = baseQuery.eq("role", filterRole);
      }
      if (filterById) {
        baseQuery = baseQuery.eq("id", filterById);
      }
  
      // Axtarış üçün
      if (searchTerm) {
        // searchTerm bir UUID-disə id üzrə axtar (eq)
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(searchTerm.trim());
  
        if (isUuid) {
          baseQuery = baseQuery.eq("id", searchTerm.trim());
        } else {
          // Yalnız string sahələrdə axtar
          let searchFields = [
            `name.ilike.%${searchTerm}%`,
            `email.ilike.%${searchTerm}%`,
            `phone_number.ilike.%${searchTerm}%`
          ];
          baseQuery = baseQuery.or(searchFields.join(","));
        }
      }
  
      const { data, error: fetchError } = await baseQuery.order("created_at", { ascending: false });
  
      if (fetchError) {
        setError(fetchError.message);
        setUsers([]);
      } else {
        setUsers(data || []);
      }
    } catch (err: any) {
      setError("İstifadəçiləri çəkərkən gözlənilməyən xəta baş verdi.");
    } finally {
      setLoading(false);
    }
  };
  
  // Komponent ilk yükləndikdə istifadəçiləri çək.
  // Axtarış və filtr funksiyası yalnız "Filtr Tətbiq Et" düyməsinə basıldıqda işləyəcək.
  useEffect(() => {
    fetchUsers();
  }, []); // Asılılıq massivi boşdur.

  // Silmə funksiyası (əlavə olaraq)
  const handleDeleteUser = async (userId: string) => {
    if (
      !window.confirm(
        "Bu istifadəçini silmək istədiyinizə əminsiniz? Bu, geri qaytarıla bilməyən bir əməliyyatdır."
      )
    ) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from("profiles")
        .delete()
        .eq("id", userId);

      if (deleteError) {
        console.error("İstifadəçini silərkən xəta:", deleteError);
        setError("İstifadəçini silərkən xəta baş verdi: " + deleteError.message);
      } else {
        alert("İstifadəçi uğurla silindi.");
        fetchUsers(); // İstifadəçi siyahısını yenilə
      }
    } catch (err: any) {
      console.error("Gözlənilməyən xəta handleDeleteUser:", err);
      setError("İstifadəçini silərkən gözlənilməyən xəta baş verdi.");
    }
  };

  // Redaktə modalını açma funksiyası
  const handleEditUser = (user: UserProfile) => {
    setEditingUser(user);
    setEditFormData({ ...user }); // Mövcud məlumatları forma yüklə
    setNewPassword(""); // Parol sahələrini sıfırla
    setPasswordConfirm("");
    setIsEditModalOpen(true);
  };

  // Redaktə form sahələrini idarə etmə
  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setEditFormData((prevData) => ({
      ...prevData,
      [name]: value,
    }));
  };

  // Məlumatları yadda saxlamaq funksiyası
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Profil məlumatlarını yenilə
      const { error: updateError } = await supabase
        .from("profiles")
        .update(editFormData) // Yalnız dəyişən sahələri göndərmək üçün Partial istifadə edin
        .eq("id", editingUser.id);

      if (updateError) {
        throw new Error(
          "Profil məlumatları yenilənərkən xəta: " + updateError.message
        );
      }

      // 2. Parolu yenilə (əgər daxil edilibsə)
      if (newPassword) {
        if (newPassword !== passwordConfirm) {
          throw new Error("Parollar uyğun gəlmir.");
        }
        if (newPassword.length < 6) {
          // Minimum parol uzunluğunu təyin edin
          throw new Error("Parol ən azı 6 simvol olmalıdır.");
        }

        // Supabase auth.updateUser metodu cari istifadəçinin parolunu dəyişir.
        // Başqa bir istifadəçinin parolunu admin olaraq dəyişmək üçün fərqli strategiya lazım ola bilər
        // Məsələn, bir `edge function` istifadə edərək `admin` rolunda Supabase SDK-dan istifadə edərək.
        // Və ya, istifadəçinin özünün parolunu sıfırlamasını tələb edən bir "parol sıfırlama" mexanizmi qurmaq.
        // Nümunə üçün burada yalnız cari istifadəçi üçün parol dəyişikliyini göstərirəm.
        // Əgər siz admin kimi başqa bir istifadəçinin parolunu dəyişmək istəyirsinizsə,
        // bu, birbaşa `supabase.auth.updateUser` ilə mümkün deyil. Bunun üçün
        // Supabase-də Custom API endpoint və ya Row Level Security (RLS) ilə xüsusi bir funksiya tələb olunur.
        const { data: authUpdateData, error: authUpdateError } = await supabase.auth.updateUser({
          password: newPassword,
        });


        if (authUpdateError) {
          console.warn(
            "Qeyd: Digər istifadəçinin parolunu admin kimi dəyişdirmək üçün xüsusi icazə və ya metod tələb oluna bilər.",
            authUpdateError
          );
          setError(
            "Parol yenilənməsi zamanı xəta: " +
            authUpdateError.message +
            ". Qeyd: Yalnız cari istifadəçinin parolunu birbaşa dəyişə bilərsiniz."
          );
          setLoading(false);
          return;
        } else {
          console.log(
            "Parol uğurla yeniləndi (yalnız cari istifadəçi üçün işləyir):",
            authUpdateData
          );
        }
      }

      alert("İstifadəçi məlumatları uğurla yeniləndi!");
      setIsEditModalOpen(false);
      fetchUsers(); // Yenilənmiş məlumatları çək
    } catch (err: any) {
      console.error("İstifadəçi məlumatlarını yadda saxlayarkən xəta:", err);
      setError(
        err.message ||
        "İstifadəçi məlumatlarını yadda saxlayarkən gözlənilməyən xəta baş verdi."
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading && !isEditModalOpen) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-6">
        <div className="flex flex-col items-center p-8 bg-white rounded-2xl shadow-xl border border-gray-200">
          <svg
            className="animate-spin h-12 w-12 text-blue-600 mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-xl font-semibold text-gray-700">
            İstifadəçilər yüklənir...
          </p>
          <p className="text-md text-gray-500 mt-2">Zəhmət olmasa gözləyin.</p>
        </div>
      </div>
    );
  }

  if (error && !isEditModalOpen) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-6">
        <div className="flex flex-col items-center p-8 bg-white rounded-2xl shadow-xl border border-red-300 text-red-700">
          <svg
            className="h-16 w-16 text-red-500 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-2xl font-bold mb-3">Xəta baş verdi!</p>
          <p className="text-lg text-center mb-6 max-w-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-red-600 text-white rounded-full font-semibold shadow-md hover:bg-red-700 transition transform hover:scale-105"
          >
            Səhifəni Yenilə
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto bg-gray-50 min-h-screen">
      <h1 className="text-4xl font-extrabold text-center text-gray-900 mb-10 drop-shadow-lg">
        İstifadəçilər İdarə Paneli
      </h1>

      {/* Filter and Search Section */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8 flex flex-col sm:flex-row gap-4 justify-between items-center">
        <input
          type="text"
          placeholder="Ad, Email və ya Telefon nömrəsi ilə axtar..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-base"
        />
        {/* YENI: ID axtarış sahəsi */}
        <input
          type="text"
          placeholder="ID ilə axtar..."
          value={filterById}
          onChange={(e) => setFilterById(e.target.value)}
          className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-base"
        />
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-base min-w-[150px]"
        >
          <option value="all">Bütün Rolar</option>
          <option value="customer">Customer</option>
          <option value="provider">Provayder</option>
          <option value="admin">Admin</option>
          {/* Digər rolları buraya əlavə edə bilərsiniz */}
        </select>
        <button
          onClick={fetchUsers} // Axtarış və filtr tətbiq etmək üçün
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition transform hover:scale-105 shadow-md"
        >
          Filtr Tətbiq Et
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white shadow-xl rounded-lg overflow-hidden border border-gray-200">
        <h3 className="text-2xl font-semibold text-gray-800 p-6 border-b border-gray-200">
          Qeydiyyatdan Keçmiş İstifadəçilər
        </h3>
        {users.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-lg italic">
            <svg
              className="h-12 w-12 text-gray-400 mx-auto mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18 10c0 1.487-.76 2.805-1.903 3.504L15 14m-1.427-4.102C12.83 11.233 10.743 13.5 10 16.5m10 0h-2M4 7v3m-4 0h4m-4 0v3m8-8c0 1.487-.76 2.805-1.903 3.504L15 14m-1.427-4.102C12.83 11.233 10.743 13.5 10 16.5m10 0h-2M4 7v3m-4 0h4m-4 0v3"
              />
            </svg>
            <p>Axtarışınıza uyğun heç bir istifadəçi tapılmadı.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Ad Soyad
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Telefon
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Qeydiyyat Tarixi
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Əməliyyatlar
                  </th>{" "}
                  {/* New column for actions */}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {user.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {user.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {user.phone_number || "Yoxdur"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                          ${user.role === "admin"
                            ? "bg-red-100 text-red-800"
                            : user.role === "provider"
                              ? "bg-green-100 text-green-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                      >
                        {user.role || "İstifadəçi"}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(user.created_at).toLocaleDateString("az-AZ", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="text-indigo-600 hover:text-indigo-900 mr-4"
                        title="İstifadəçini Redaktə Et"
                      >
                        Redaktə Et
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-red-600 hover:text-red-900"
                        title="İstifadəçini Sil"
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {isEditModalOpen && editingUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50 overflow-auto">
          <div className="bg-white rounded-lg shadow-xl p-8 w-full mx-auto transform transition-all scale-100 opacity-100">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">
              İstifadəçini Redaktə Et
            </h2>
            {error && (
              <div
                className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
                role="alert"
              >
                <strong className="font-bold">Xəta!</strong>
                <span className="block sm:inline"> {error}</span>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveUser();
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Ad Soyad
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={editFormData.name || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={editFormData.email || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="phone_number"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Telefon Nömrəsi
                  </label>
                  <input
                    type="text"
                    id="phone_number"
                    name="phone_number"
                    value={editFormData.phone_number || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="role"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Rol
                  </label>
                  <select
                    id="role"
                    name="role"
                    value={editFormData.role || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    required
                  >
                    <option value="user">İstifadəçi</option>
                    <option value="provider">Provayder</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="address"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Ünvan
                  </label>
                  <input
                    type="text"
                    id="address"
                    name="address"
                    value={editFormData.address || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="birth_date"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Doğum Tarixi
                  </label>
                  <input
                    type="date"
                    id="birth_date"
                    name="birth_date"
                    value={
                      editFormData.birth_date
                        ? new Date(editFormData.birth_date)
                          .toISOString()
                          .split("T")[0]
                        : ""
                    }
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                {/* Digər sahələri buraya əlavə edin (company_name, experience_years, specialties, status, is_verified, avatar_url, balance, bonus_balance) */}
                {editingUser.role === "provider" && (
                  <>
                    <div>
                      <label
                        htmlFor="company_name"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Şirkət Adı
                      </label>
                      <input
                        type="text"
                        id="company_name"
                        name="company_name"
                        value={editFormData.company_name || ""}
                        onChange={handleFormChange}
                        className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="experience_years"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Təcrübə İlləri
                      </label>
                      <input
                        type="number"
                        id="experience_years"
                        name="experience_years"
                        value={editFormData.experience_years || ""}
                        onChange={handleFormChange}
                        className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="specialties"
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        İxtisaslar (vergüllə ayırın)
                      </label>
                      <input
                        type="text"
                        id="specialties"
                        name="specialties"
                        value={
                          Array.isArray(editFormData.specialties)
                            ? editFormData.specialties.join(", ")
                            : ""
                        }
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            specialties: e.target.value
                              .split(",")
                              .map((s) => s.trim()),
                          })
                        }
                        className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label
                    htmlFor="status"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    value={editFormData.status || ""}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="active">Aktiv</option>
                    <option value="inactive">Passiv</option>
                    <option value="pending">Gözləmədə</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_verified"
                    name="is_verified"
                    checked={editFormData.is_verified || false}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        is_verified: e.target.checked,
                      })
                    }
                    className="h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label
                    htmlFor="is_verified"
                    className="text-sm font-medium text-gray-700"
                  >
                    Təsdiqlənib
                  </label>
                </div>
                <div>
                  <label
                    htmlFor="balance"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Balans
                  </label>
                  <input
                    type="number"
                    id="balance"
                    name="balance"
                    value={editFormData.balance || 0}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bonus_balance"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Bonus Balans
                  </label>
                  <input
                    type="number"
                    id="bonus_balance"
                    name="bonus_balance"
                    value={editFormData.bonus_balance || 0}
                    onChange={handleFormChange}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4 mt-4">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">
                  Parolu Yenilə
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  Bu hissəni yalnız parolu dəyişmək istəyirsinizsə doldurun.
                </p>
                <div className="mb-4">
                  <label
                    htmlFor="new_password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Yeni Parol
                  </label>
                  <input
                    type="password"
                    id="new_password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Yeni parol"
                  />
                </div>
                <div className="mb-6">
                  <label
                    htmlFor="confirm_password"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Parolu Təsdiqlə
                  </label>
                  <input
                    type="password"
                    id="confirm_password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className="mt-1 block w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Yeni parolu təsdiqlə"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-6 py-3 border border-gray-300 rounded-md text-gray-700 font-semibold hover:bg-gray-100 transition-colors"
                >
                  Ləğv Et
                </button>
                <button
                  type="submit"
                  className="px-6 py-3 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 transition-colors"
                  disabled={loading}
                >
                  {loading ? "Yadda Saxlanılır..." : "Yadda Saxla"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersAdmin;