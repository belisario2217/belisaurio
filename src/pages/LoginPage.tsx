import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Eye, EyeOff, GraduationCap, LockKeyhole, Mail, MapPin, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, Field } from "../components/Ui";
import { InstitutionLogo } from "../components/InstitutionLogo";
import { api } from "../lib/api";
import "../login.css";

type Branding = { institution_name: string; logo_path: string | null };

export function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [branding, setBranding] = useState<Branding>({ institution_name: "Universidad IFOP", logo_path: null });

  useEffect(() => {
    api<Branding>("/branding").then(setBranding).catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ifop-login">
      <section className="ifop-login-story" aria-label="Bienvenida institucional">
        <div className="ifop-login-grain" aria-hidden="true" />
        <svg className="ifop-login-orbit" viewBox="0 0 680 680" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="ifop-orbit-light" x1="80" y1="40" x2="590" y2="630" gradientUnits="userSpaceOnUse">
              <stop stopColor="#d5e5ff" /><stop offset=".5" stopColor="#7399ed" /><stop offset="1" stopColor="#3458aa" stopOpacity=".2" />
            </linearGradient>
          </defs>
          <circle cx="340" cy="340" r="268" stroke="url(#ifop-orbit-light)" strokeWidth="64" opacity=".32" />
          <circle cx="340" cy="340" r="222" stroke="#bbd3ff" strokeWidth="1" opacity=".35" />
          <circle cx="340" cy="340" r="313" stroke="#bbd3ff" strokeWidth="1" opacity=".24" strokeDasharray="3 12" />
          <ellipse cx="340" cy="340" rx="320" ry="135" transform="rotate(-37 340 340)" stroke="#d0e0ff" strokeWidth="1.5" opacity=".5" />
          <circle cx="111" cy="509" r="9" fill="#c3d8ff" /><circle cx="527" cy="95" r="5" fill="#d8e6ff" />
        </svg>
        <header className="ifop-login-brand">
          <div className="ifop-login-logo"><InstitutionLogo logoPath={branding.logo_path} /></div>
          <div><strong>{branding.institution_name}</strong><span>Gestión académica · Tabasco</span></div>
        </header>
        <div className="ifop-login-message">
          <div className="ifop-login-eyebrow"><span /> CONOCIMIENTO QUE TRANSFORMA</div>
          <h1>Tu futuro<br /><em>empieza aquí.</em></h1>
          <p>Aprende, crece y construye lo que sigue. Tu comunidad universitaria, más cerca de ti.</p>
          <div className="ifop-login-community"><span className="ifop-login-community-icon"><GraduationCap size={20} /></span><div><strong>Un mismo lugar. Más posibilidades.</strong><span>Alumnos · Docentes · Administración</span></div></div>
        </div>
        <footer className="ifop-login-story-footer"><span><MapPin size={14} /> Tabasco, México</span><span><BookOpen size={14} /> Comunidad IFOP</span></footer>
      </section>
      <section className="ifop-login-access" aria-labelledby="ifop-login-title">
        <div className="ifop-login-access-label"><span /> PORTAL INSTITUCIONAL</div>
        <div className="ifop-login-card">
          <div className="ifop-login-heading">
            <div className="ifop-login-welcome-icon" aria-hidden="true"><Sparkles size={24} /></div>
            <span>QUÉ GUSTO TENERTE AQUÍ</span>
            <h2 id="ifop-login-title">Bienvenido de vuelta<span>.</span></h2>
            <p>Inicia sesión con tu cuenta institucional.</p>
          </div>
          <form onSubmit={submit} className="ifop-login-form" aria-busy={busy}>
            <Field label="Correo electrónico" required>
              <div className="ifop-login-input">
                <Mail size={18} aria-hidden="true" />
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="Tu correo institucional" autoCapitalize="none" spellCheck={false} disabled={busy} required />
              </div>
            </Field>
            <Field label="Contraseña" required>
              <div className="ifop-login-input">
                <LockKeyhole size={18} aria-hidden="true" />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Escribe tu contraseña" disabled={busy} required />
                <button type="button" className="ifop-login-password" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <Button type="submit" busy={busy} icon={<ArrowRight size={18} />}>{busy ? "Ingresando…" : "Entrar a mi plataforma"}</Button>
          </form>
          <div className="ifop-login-help"><span>¿Necesitas ayuda con tu acceso?</span><strong>Acércate a Control Escolar.</strong></div>
        </div>
        <footer className="ifop-login-footer">© {new Date().getFullYear()} {branding.institution_name}<span>Tu formación nos conecta.</span></footer>
      </section>
    </main>
  );
}
