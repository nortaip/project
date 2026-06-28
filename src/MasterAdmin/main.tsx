import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';

// Eager-load: Dashboard (default landing page)
import Dashboard from './Dashboard';

// Lazy-load all other admin pages — admin paneli ilkin yüklədikdə bundle ölçüsünü
// xeyli azaldır (1.3MB → ~600KB ilkin).
const Users = lazy(() => import('./Users'));
const AuditLog = lazy(() => import('./AuditLog'));
const CategoriesAdmin = lazy(() => import('./CategoriesAdmin'));
const SubcategoriesAdmin = lazy(() => import('./SubcategoriesAdmin'));
const QuestionsAdmin = lazy(() => import('./QuestionsAdmin'));
const PricesAdmin = lazy(() => import('./PricesAdmin'));
const OpportunitiesPageAdmin = lazy(() => import('./OpportunitiesPageAdmin'));
const CommissionSettings = lazy(() => import('./CommissionSettings'));
const ReportsPage = lazy(() => import('./ReportsPage'));
const WithdrawalsPage = lazy(() => import('./WithdrawalsPage'));
const BrigadeApplicationsAdmin = lazy(() => import('./BrigadeApplicationsAdmin'));
const ProviderRequestsAdmin = lazy(() => import('./ProviderRequestsAdmin'));
const KycAdmin = lazy(() => import('./KycAdmin'));
const CompaniesAdmin = lazy(() => import('./CompaniesAdmin'));
const PromoCodesAdmin = lazy(() => import('./PromoCodesAdmin'));
const BannersAdmin = lazy(() => import('./BannersAdmin'));

function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
        <p className="text-sm text-muted font-bold">Yüklənir...</p>
      </div>
    </div>
  );
}

/**
 * MasterAdmin entry — nested routing + lazy loading.
 *
 * /Administrator/* altında mount olunur (RequireRole guard App.tsx-də).
 */
export default function AdminPanel() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route
          path="banners"
          element={
            <AdminLayout
              title="Reklam bannerləri"
              subtitle="Ana səhifə bannerlərini idarə et (veb + mobil)"
            >
              <BannersAdmin />
            </AdminLayout>
          }
        />
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
        <Route
          path="withdrawals"
          element={
            <AdminLayout
              title="Nağdlaşdırma sorğuları"
              subtitle="Provayderlərin pul çıxarış istəkləri — Epoint və ya manual emal"
            >
              <WithdrawalsPage />
            </AdminLayout>
          }
        />
        <Route path="audit" element={<AuditLog />} />
        <Route
          path="brigades"
          element={
            <AdminLayout
              title="Briqada müraciətləri"
              subtitle="Provayder şirkət açma müraciətlərini təsdiqlə və ya imtina et"
            >
              <BrigadeApplicationsAdmin />
            </AdminLayout>
          }
        />
        <Route
          path="companies"
          element={
            <AdminLayout
              title="Şirkətlər"
              subtitle="Briqadaların hər şeyi — işçilər, komissiya %, sifarişlər, balans köçürmələri və loglar"
            >
              <CompaniesAdmin />
            </AdminLayout>
          }
        />
        <Route
          path="promos"
          element={
            <AdminLayout
              title="Promo kodlar"
              subtitle="Endirim kodları yarat, istifadə sayını izlə"
            >
              <PromoCodesAdmin />
            </AdminLayout>
          }
        />
        <Route
          path="providers"
          element={
            <AdminLayout
              title="Provayder müraciətləri"
              subtitle="Provayder statusuna keçmək istəyən istifadəçiləri təsdiqlə"
            >
              <ProviderRequestsAdmin />
            </AdminLayout>
          }
        />
        <Route
          path="kyc"
          element={
            <AdminLayout
              title="KYC yoxlaması"
              subtitle="Provayder kimlik sənədlərini (şəxsiyyət + selfi) yoxla və təsdiqlə"
            >
              <KycAdmin />
            </AdminLayout>
          }
        />

        {/* Köhnə tab-əsaslı səhifələr */}
        <Route path="categories" element={<LegacyWrap><CategoriesAdmin /></LegacyWrap>} />
        <Route path="subcategories" element={<LegacyWrap><SubcategoriesAdmin /></LegacyWrap>} />
        <Route path="questions" element={<LegacyWrap><QuestionsAdmin /></LegacyWrap>} />
        <Route path="prices" element={<LegacyWrap><PricesAdmin /></LegacyWrap>} />
        <Route path="opportunities" element={<LegacyWrap><OpportunitiesPageAdmin /></LegacyWrap>} />
      </Routes>
    </Suspense>
  );
}

function LegacyWrap({ children }: { children: React.ReactNode }) {
  return (
    <AdminLayout title="Admin">
      {children}
    </AdminLayout>
  );
}
