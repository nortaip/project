import { Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard';
import Users from './Users';
import AuditLog from './AuditLog';
import CategoriesAdmin from './CategoriesAdmin';
import SubcategoriesAdmin from './SubcategoriesAdmin';
import QuestionsAdmin from './QuestionsAdmin';
import PricesAdmin from './PricesAdmin';
import OpportunitiesPageAdmin from './OpportunitiesPageAdmin';
import CommissionSettings from './CommissionSettings';
import ReportsPage from './ReportsPage';
import AdminLayout from './AdminLayout';

/**
 * MasterAdmin entry — proper nested routing.
 *
 * Mounted under /Administrator/* (RequireRole guard tətbiq olunur App.tsx-də).
 *
 * Yeni səhifə əlavə etmək üçün:
 *   1. Bu fayl üçün `<Route>` əlavə et
 *   2. AdminLayout-da NAV_ITEMS-ə əlavə et
 */
export default function AdminPanel() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="users" element={<Users />} />
      <Route
        path="commissions"
        element={
          <AdminLayout
            title="Komissiya parametrləri"
            subtitle="Təklifin qəbulu, iş bitməsi və nağdlaşdırma faizləri"
          >
            <CommissionSettings />
          </AdminLayout>
        }
      />
      <Route
        path="reports"
        element={
          <AdminLayout
            title="Gəlir hesabatı"
            subtitle="Platforma əməliyyatları və komissiya gəlirləri"
          >
            <ReportsPage />
          </AdminLayout>
        }
      />
      <Route path="audit" element={<AuditLog />} />

      {/* Köhnə tab-əsaslı səhifələr — AdminLayout ilə wrap olunmalıdır.
          Onlar hələ köhnə dizayndadır, ona görə fallback üçün belə qoyulur. */}
      <Route path="categories" element={<LegacyWrap><CategoriesAdmin /></LegacyWrap>} />
      <Route path="subcategories" element={<LegacyWrap><SubcategoriesAdmin /></LegacyWrap>} />
      <Route path="questions" element={<LegacyWrap><QuestionsAdmin /></LegacyWrap>} />
      <Route path="prices" element={<LegacyWrap><PricesAdmin /></LegacyWrap>} />
      <Route path="opportunities" element={<LegacyWrap><OpportunitiesPageAdmin /></LegacyWrap>} />
    </Routes>
  );
}

/** Köhnə (Ant Design əsaslı) admin səhifələrini yeni layout-a sarımaq üçün */
function LegacyWrap({ children }: { children: React.ReactNode }) {
  return (
    <AdminLayout title="Admin">
      {children}
    </AdminLayout>
  );
}
