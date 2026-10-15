import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";

const ImportAssistantPage = lazy(() => import("./pages/ImportAssistantPage").then(module => ({ default: module.ImportAssistantPage })));
const WorkspacePage = lazy(() => import("./pages/WorkspacePage").then(module => ({ default: module.WorkspacePage })));
const StudentDossierPage = lazy(() => import("./pages/StudentDossierPage").then(module => ({ default: module.StudentDossierPage })));
const PayrollPage = lazy(() => import("./pages/PayrollPage").then(module => ({ default: module.PayrollPage })));
const BalancePage = lazy(() => import("./pages/BalancePage").then(module => ({ default: module.BalancePage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const StudentsPage = lazy(() => import("./pages/StudentsPage").then((module) => ({ default: module.StudentsPage })));
const GradesPage = lazy(() => import("./pages/GradesPage").then((module) => ({ default: module.GradesPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage })));
const CatalogsPage = lazy(() => import("./pages/CatalogsPage").then((module) => ({ default: module.CatalogsPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const PlansPage = lazy(() => import("./pages/PlansPage").then((module) => ({ default: module.PlansPage })));
const StudentPortalPage = lazy(() => import("./pages/StudentPortalPage").then((module) => ({ default: module.StudentPortalPage })));
const PaymentsPage = lazy(() => import("./pages/PaymentsPage").then((module) => ({ default: module.PaymentsPage })));
const TuitionGridPage = lazy(() => import("./pages/TuitionGridPage").then((module) => ({ default: module.TuitionGridPage })));
const MessagesAdminPage = lazy(() => import("./pages/MessagesAdminPage").then((module) => ({ default: module.MessagesAdminPage })));
const StudentMessagesPage = lazy(() => import("./pages/StudentMessagesPage").then((module) => ({ default: module.StudentMessagesPage })));
const GroupManagementPage = lazy(() => import("./pages/GroupManagementPage").then((module) => ({ default: module.GroupManagementPage })));
const AttendancePage = lazy(() => import("./pages/AttendancePage").then((module) => ({ default: module.AttendancePage })));
const DocumentVerificationPage = lazy(() => import("./pages/DocumentVerificationPage").then(module => ({ default: module.DocumentVerificationPage })));
const CredentialsPage = lazy(() => import("./pages/CredentialsPage").then(module => ({ default: module.CredentialsPage })));
const MyCredentialPage = lazy(() => import("./pages/MyCredentialPage").then(module => ({ default: module.MyCredentialPage })));
const CredentialVerificationPage = lazy(() => import("./pages/CredentialVerificationPage").then(module => ({ default: module.CredentialVerificationPage })));

function HomePage() {
  const { user, can } = useAuth();
  if (user?.studentId && can("portal.view")) return <Navigate to="/mi-avance" replace />;
  return <WorkspacePage />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loader"><LoaderCircle className="spin" size={28} /><span>Preparando tu espacio</span></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export function App() {
  const { user } = useAuth();
  return (
    <Suspense fallback={<div className="app-loader"><LoaderCircle className="spin" size={28} /><span>Cargando módulo</span></div>}>
      <Routes>
        <Route path="/verificar-documento/:token" element={<DocumentVerificationPage />} />
        <Route path="/verificar-credencial/:token" element={<CredentialVerificationPage />} />
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="*" element={
          <Protected>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/alumnos" element={<StudentsPage />} />
              <Route path="/alumnos/:id/expediente" element={<StudentDossierPage />} />
              <Route path="/asistente-importacion" element={<ImportAssistantPage />} />
              <Route path="/balance" element={<BalancePage />} />
              <Route path="/nomina" element={<PayrollPage />} />
              <Route path="/panel" element={<DashboardPage />} />
              <Route path="/grupos" element={<GroupManagementPage />} />
              <Route path="/calificaciones" element={<GradesPage />} />
              <Route path="/asistencia" element={<AttendancePage />} />
              <Route path="/analiticas" element={<AnalyticsPage />} />
              <Route path="/reportes" element={<ReportsPage />} />
              <Route path="/documentos" element={<ReportsPage view="documents" />} />
              <Route path="/credenciales" element={<CredentialsPage />} />
              <Route path="/cobros" element={<PaymentsPage />} />
              <Route path="/colegiaturas-mensuales" element={<TuitionGridPage />} />
              <Route path="/mensajes-admin" element={<MessagesAdminPage />} />
              <Route path="/catalogos" element={<CatalogsPage />} />
              <Route path="/planes" element={<PlansPage />} />
              <Route path="/mi-avance" element={<StudentPortalPage />} />
              <Route path="/mi-credencial" element={<MyCredentialPage />} />
              <Route path="/mensajes" element={<StudentMessagesPage />} />
              <Route path="/usuarios" element={<UsersPage />} />
              <Route path="/configuracion" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Protected>
        } />
      </Routes>
    </Suspense>
  );
}
