import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import { MerchantDetailPage, MerchantsPage } from "./pages/MerchantsPage";
import {
  AuditPage,
  OperationsPage,
  PattisPage,
  PurchasesPage,
  ReportsPage,
  SettingsPage,
  VendorBillsPage,
} from "./pages/ListsPages";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("lm.admin.token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/merchants" element={<RequireAuth><MerchantsPage /></RequireAuth>} />
      <Route path="/merchants/:id" element={<RequireAuth><MerchantDetailPage /></RequireAuth>} />
      <Route path="/operations" element={<RequireAuth><OperationsPage /></RequireAuth>} />
      <Route path="/pattis" element={<RequireAuth><PattisPage /></RequireAuth>} />
      <Route path="/vendor-bills" element={<RequireAuth><VendorBillsPage /></RequireAuth>} />
      <Route path="/purchases" element={<RequireAuth><PurchasesPage /></RequireAuth>} />
      <Route path="/reports" element={<RequireAuth><ReportsPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth><AuditPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
