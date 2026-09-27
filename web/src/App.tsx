import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ToastContainer } from "react-toastify";
import { AuthProvider, useAuth } from "./AuthContext";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { DashboardPage } from "./pages/DashboardPage";
import { TrashPage } from "./pages/TrashPage";
import { UsersPage } from "./pages/UsersPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { WorkspaceSettingsPage } from "./pages/WorkspaceSettingsPage";
import { SearchPage } from "./pages/SearchPage";
import { InvitePage, SharePage } from "./pages/InviteSharePages";
import { PreviewPage } from "./pages/PreviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { MySharesPage } from "./pages/MySharesPage";
import { SharedWithMePage } from "./pages/SharedWithMePage";
import { AppShell } from "./components/AppShell";
import { loginWithNext } from "./helpers/authRedirect";
import "./toast";
import "./alertify";

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="layout">Loading…</p>;
  if (!user) {
    return (
      <Navigate
        to={loginWithNext(`${location.pathname}${location.search}`)}
        replace
      />
    );
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workspaces/:id" element={<WorkspacePage />} />
        <Route path="/workspaces/:id/settings" element={<WorkspaceSettingsPage tab="edit" />} />
        <Route
          path="/workspaces/:id/settings/permissions"
          element={<WorkspaceSettingsPage tab="permissions" />}
        />
        <Route path="/preview/:documentId" element={<PreviewPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/settings" element={<SettingsPage tab="email" />} />
        <Route path="/settings/storage" element={<SettingsPage tab="storage" />} />
        <Route path="/shares/mine" element={<MySharesPage />} />
        <Route path="/shares/with-me" element={<SharedWithMePage />} />
        <Route path="/search" element={<SearchPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <ToastContainer
        position="top-right"
        autoClose={3000}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="light"
        style={{ position: "fixed", zIndex: 9999 }}
      />
    </AuthProvider>
  );
}
