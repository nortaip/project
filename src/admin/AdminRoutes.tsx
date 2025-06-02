import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProviderSidebar from "./ProviderSidebar";
import OpportunitiesPage from "./OpportunitiesPage";
import OffersPage from "./OffersPage";
import WonPage from "./WonPage";
import ServicesPage from "./ServicesPage";
import BalancePage from "./BalancePage";

const AdminRoutes: React.FC = () => (
  <div className="flex bg-gray-50 min-h-screen">
    <ProviderSidebar />
    <main className="flex-1 p-6">
      <Routes>
        <Route path="opportunities" element={<OpportunitiesPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="won" element={<WonPage />} />
        <Route path="services" element={<ServicesPage />} />
        <Route path="balance" element={<BalancePage />} />
        <Route path="*" element={<Navigate to="opportunities" replace />} />
      </Routes>
    </main>
  </div>
);

export default AdminRoutes;
