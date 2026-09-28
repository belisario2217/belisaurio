import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3, BookOpenCheck, ChevronLeft, ChevronRight, FileBarChart, GraduationCap,
  LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, SlidersHorizontal, UsersRound, X, BookCopy, CircleGauge, ReceiptText, Megaphone, TableProperties, School, CalendarCheck
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { InstitutionLogo } from "./InstitutionLogo";

type Institution = { institution_name: string; logo_path: string | null; active_cycle_name: string | null };

const navItems = [
  { to: "/", label: "Panel", icon: LayoutDashboard, permission: "dashboard.view" },
  { to: "/alumnos", label: "Alumnos", icon: GraduationCap, permission: "students.view" },
  { to: "/grupos", label: "Administración de grupos", icon: School, permission: "students.view" },
  { to: "/calificaciones", label: "Calificaciones", icon: BookOpenCheck, permission: "grades.view" },
  { to: "/asistencia", label: "Asistencia", icon: CalendarCheck, permission: "attendance.view" },
  { to: "/cobros", label: "Cobros", icon: ReceiptText, permission: "payments.view" },
  { to: "/colegiaturas-mensuales", label: "Colegiaturas mensuales", icon: TableProperties, permission: "tuition.manage" },
  { to: "/mensajes-admin", label: "Mensajes", icon: Megaphone, permission: "messages.view" },
  { to: "/analiticas", label: "Analíticas", icon: BarChart3, permission: "analytics.view" },
  { to: "/reportes", label: "Reportes", icon: FileBarChart, permission: "reports.view" },
  { to: "/catalogos", label: "Catálogos", icon: SlidersHorizontal, permission: "catalogs.view" },
  { to: "/planes", label: "Planes académicos", icon: BookCopy, permission: "catalogs.view" },
  { to: "/mi-avance", label: "Mi avance", icon: CircleGauge, permission: "portal.view", studentOnly: true },
  { to: "/mensajes", label: "Mensajes importantes", icon: Megaphone, permission: "portal.view", studentOnly: true },
  { to: "/usuarios", label: "Usuarios y roles", icon: UsersRound, permission: "users.manage" },
  { to: "/configuracion", label: "Configuración", icon: Settings, permission: "settings.manage" }
];

const titles: Record<string, string> = {
  "/": "Panel académico",
  "/alumnos": "Gestión de alumnos",
  "/grupos": "Administración de grupos",
  "/calificaciones": "Captura de calificaciones",
  "/asistencia": "Asistencia diaria",
  "/cobros": "Registro de cobros",
  "/colegiaturas-mensuales": "Colegiaturas mensuales",
  "/mensajes-admin": "Mensajes importantes",
  "/analiticas": "Analíticas académicas",
  "/reportes": "Reportes y documentos",
  "/catalogos": "Catálogos administrativos",
  "/planes": "Planes académicos",
  "/mi-avance": "Mi avance curricular",
  "/mensajes": "Mensajes importantes",
  "/usuarios": "Usuarios y roles",
  "/configuracion": "Configuración institucional"
};

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [institution, setInstitution] = useState<Institution | null>(null);

  useEffect(() => {
    api<{ settings: Institution }>("/settings").then((data) => setInstitution(data.settings)).catch(() => undefined);
  }, []);
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <InstitutionLogo logoPath={institution?.logo_path} />
          <div className="brand-copy">
            <strong>{institution?.institution_name || "Universidad IFOP"}</strong>
            <span>Gestión académica</span>
          </div>
          <button className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={19} /></button>
        </div>
        <nav className="main-nav">
          <span className="nav-section-label">Operación</span>
          {navItems.filter((item) => can(item.permission) && (!("studentOnly" in item) || !item.studentOnly || Boolean(user?.studentId))).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/"} title={collapsed ? item.label : undefined}>
              <item.icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="cycle-chip">
            <ShieldCheck size={17} />
            <div><span>Ciclo activo</span><strong>{institution?.active_cycle_name || "Sin definir"}</strong></div>
          </div>
          <button className="collapse-button" onClick={() => setCollapsed((current) => !current)} title={collapsed ? "Expandir menú" : "Contraer menú"}>
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            <span>Contraer menú</span>
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button>
            <div>
              <span>{new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}</span>
              <h1>{titles[location.pathname] || "Universidad IFOP"}</h1>
            </div>
          </div>
          <div className="account">
            <div className="avatar">{user?.fullName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
            <div className="account-copy"><strong>{user?.fullName}</strong><span>{user?.roleName}</span></div>
            <button className="icon-button" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
