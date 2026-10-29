import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  BarChart3, BookOpenCheck, ChevronLeft, ChevronRight, FileBarChart, GraduationCap,
  LayoutDashboard, LogOut, Menu, Search, Sparkles, Settings, ShieldCheck, SlidersHorizontal, UsersRound, X, BookCopy, CircleGauge, ReceiptText, Megaphone, TableProperties, School, IdCard
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Modal } from "./Modal";
import { InstitutionLogo } from "./InstitutionLogo";

type Institution = { institution_name: string; logo_path: string | null; active_cycle_name: string | null };

const navItems = [
  { to: "/", label: "Inicio", icon: LayoutDashboard, permission: null },
  { to: "/alumnos", label: "Alumnos", icon: GraduationCap, permission: "students.view" },
  { to: "/grupos", label: "Administración de grupos", icon: School, permission: "students.view" },
  { to: "/calificaciones", label: "Calificaciones", icon: BookOpenCheck, permission: "grades.view" },
  { to: "/cobros", label: "Cobros", icon: ReceiptText, permission: "payments.view" },
  { to: "/colegiaturas-mensuales", label: "Colegiaturas mensuales", icon: TableProperties, permission: "tuition.manage" },
  { to: "/mensajes-admin", label: "Mensajes", icon: Megaphone, permission: "messages.view" },
  { to: "/analiticas", label: "Analíticas", icon: BarChart3, permission: "analytics.view" },
  { to: "/documentos", label: "Documentos", icon: FileBarChart, permission: "reports.view" },
  { to: "/credenciales", label: "Credenciales", icon: IdCard, permission: "credentials.manage" },
  { to: "/nomina", label: "Nómina", icon: UsersRound, permission: "payments.view" },
  { to: "/balance", label: "Balance", icon: ReceiptText, permission: "payments.view" },
  { to: "/asistente-importacion", label: "Asistente de archivos", icon: Sparkles, permission: "import" },
  { to: "/reportes", label: "Reportes", icon: FileBarChart, permission: "reports.view" },
  { to: "/catalogos", label: "Catálogos", icon: SlidersHorizontal, permission: "catalogs.view" },
  { to: "/planes", label: "Planes académicos", icon: BookCopy, permission: "catalogs.view" },
  { to: "/mi-avance", label: "Mi avance", icon: CircleGauge, permission: "portal.view", studentOnly: true },
  { to: "/mis-calificaciones", label: "Mis calificaciones", icon: BookOpenCheck, permission: "portal.view", studentOnly: true },
  { to: "/mis-pagos", label: "Mis pagos", icon: ReceiptText, permission: "portal.view", studentOnly: true },
  { to: "/mi-credencial", label: "Mi credencial", icon: IdCard, permission: "portal.view", studentOnly: true },
  { to: "/mensajes", label: "Mensajes importantes", icon: Megaphone, permission: "portal.view", studentOnly: true },
  { to: "/usuarios", label: "Usuarios y roles", icon: UsersRound, permission: "users.manage" },
  { to: "/configuracion", label: "Configuración", icon: Settings, permission: "settings.manage" }
];

const titles: Record<string, string> = {
  "/": "Panel académico",
  "/alumnos": "Gestión de alumnos",
  "/grupos": "Administración de grupos",
  "/calificaciones": "Captura de calificaciones",
  "/cobros": "Registro de cobros",
  "/colegiaturas-mensuales": "Colegiaturas mensuales",
  "/mensajes-admin": "Mensajes importantes",
  "/analiticas": "Analíticas académicas",
  "/reportes": "Reportes y avance académico",
  "/documentos": "Documentos oficiales",
  "/credenciales": "Credenciales estudiantiles",
  "/nomina": "Nómina docente y administrativa",
  "/balance": "Balance mensual",
  "/asistente-importacion": "Asistente de archivos",
  "/catalogos": "Catálogos administrativos",
  "/planes": "Planes académicos",
  "/mi-avance": "Mi avance curricular",
  "/mis-calificaciones": "Mis calificaciones",
  "/mis-pagos": "Mis pagos",
  "/mi-credencial": "Mi credencial",
  "/mensajes": "Mensajes importantes",
  "/usuarios": "Usuarios y roles",
  "/configuracion": "Configuración institucional"
};

const sections = [
  { name: "Mi espacio", area: "general", paths: ["/", "/mi-avance", "/mis-calificaciones", "/mis-pagos", "/mi-credencial"] },
  { name: "Gestión académica", area: "academic", paths: ["/alumnos", "/grupos", "/planes", "/calificaciones"] },
  { name: "Servicios escolares", area: "campus", paths: ["/documentos", "/credenciales", "/asistente-importacion"] },
  { name: "Finanzas", area: "finance", paths: ["/balance", "/cobros", "/colegiaturas-mensuales", "/nomina"] },
  { name: "Información y comunidad", area: "community", paths: ["/mensajes-admin", "/mensajes", "/reportes", "/analiticas"] },
  { name: "Configuración", area: "settings", paths: ["/catalogos", "/usuarios", "/configuracion"] }
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: number; name: string; detail: string; path: string }>>([]);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && can("students.view")) { event.preventDefault(); setSearchOpen(true); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [user]);
  useEffect(() => {
    if (!searchOpen) return;
    if (search.trim().length < 2) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => { setSearchError(""); api<typeof results>(`/improvements/search?q=${encodeURIComponent(search.trim())}`, { signal: controller.signal }).then(setResults).catch(error => { if (!controller.signal.aborted) setSearchError(error.message); }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, searchOpen]);
  const currentSection = sections.find(group => group.paths.some(path => path === location.pathname || (path !== "/" && location.pathname.startsWith(path + "/")))) ?? sections[0];
  const section = location.pathname === "/mis-pagos" ? "finance" : ["/mi-avance", "/mis-calificaciones"].includes(location.pathname) ? "academic" : location.pathname === "/mi-credencial" ? "campus" : currentSection.area;
  const allowed = (item: typeof navItems[number]) => (!item.permission || (item.permission === "import" ? can("students.import") || can("grades.import") : can(item.permission))) && (!("studentOnly" in item) || !item.studentOnly || Boolean(user?.studentId));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  function closeMobileMenu() { setMobileOpen(false); menuButton.current?.focus(); }
  useEffect(() => {
    if (!mobileOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobileOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", close); };
  }, [mobileOpen]);
  const [institution, setInstitution] = useState<Institution | null>(null);

  useEffect(() => {
    api<Institution>("/branding").then(setInstitution).catch(() => undefined);
  }, []);
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div data-section={section} className={`app-shell liquid-campus ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="campus-skip-link" href="#campus-main">Saltar al contenido</a>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobileMenu} aria-label="Cerrar menú" />}
      <aside id="campus-navigation" className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <InstitutionLogo logoPath={institution?.logo_path} />
          <div className="brand-copy">
            <strong>{institution?.institution_name || "Universidad IFOP"}</strong>
            <span>Gestión académica</span>
          </div>
          <button className="icon-button sidebar-mobile-close" onClick={closeMobileMenu} aria-label="Cerrar menú"><X size={19} /></button>
        </div>
        <nav className="main-nav" aria-label="Secciones de la plataforma">
          {sections.map(group => {
            const items = group.paths.flatMap(path => navItems.filter(item => item.to === path && allowed(item)));
            return items.length ? <div className="nav-category" data-area={group.area} key={group.name}>
              <span className="nav-section-label">{group.name}</span>
              {items.map(item => <NavLink key={item.to} to={item.to} end={item.to === "/"} title={item.label} aria-label={item.label}><item.icon size={19} strokeWidth={1.8}/><span>{item.label}</span></NavLink>)}
            </div> : null;
          })}
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
            <button ref={menuButton} className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menú" aria-expanded={mobileOpen} aria-controls="campus-navigation"><Menu size={20} /></button>
            <div>
              <span className="topbar-eyebrow"><b>{currentSection.name}</b><i aria-hidden="true" />{new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}</span>
              <h1>{titles[location.pathname] || (location.pathname.startsWith("/alumnos/") ? "Expediente del alumno" : "Universidad IFOP")}</h1>
            </div>
          </div>
          <div className="account">
            {can("students.view") && user?.roleName !== "Docente" && <button className="icon-button" aria-label="Buscar alumnos" title="Buscar alumnos (Ctrl+K)" onClick={() => setSearchOpen(true)}><Search size={18}/></button>}
            <div className="avatar">{user?.fullName.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
            <div className="account-copy"><strong>{user?.fullName}</strong><span>{user?.roleName}</span></div>
            <button className="icon-button" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={18} /></button>
          </div>
        </header>
        <main id="campus-main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Buscar alumnos">
        <div className="page-stack"><label className="search-box"><Search size={18}/><input autoFocus placeholder="Nombre o matrícula (mínimo 2 letras)" value={search} onChange={event => setSearch(event.target.value)}/></label>
          {searchError && <p role="alert">{searchError}</p>}
          <div className="quick-search-results">{results.map(row => <Link key={row.id} to={row.path} onClick={() => setSearchOpen(false)}><strong>{row.name}</strong><span>{row.detail}</span></Link>)}</div>
          {search.length >= 2 && !results.length && !searchError && <p>No se encontraron alumnos.</p>}
        </div>
      </Modal>
    </div>
  );
}
