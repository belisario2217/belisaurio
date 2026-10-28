import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";
import { Button, Field } from "../components/Ui";
import { InstitutionLogo } from "../components/InstitutionLogo";
import { api } from "../lib/api";

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
    setBusy(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No fue posible iniciar sesion.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-identity">
        <InstitutionLogo logoPath={branding.logo_path} />
        <div>
          <span className="identity-kicker">Sistema de gestión académica</span>
          <h1>{branding.institution_name}</h1>
          <p>Tabasco</p>
        </div>
        <div className="identity-lines" aria-hidden="true"><i /><i /><i /></div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <div className="login-heading">
            <span>Acceso institucional</span>
            <h2>Bienvenido de vuelta</h2>
            <p>Ingresa con tu cuenta asignada.</p>
          </div>
          <Field label="Correo electronico" required>
            <div className="input-with-icon">
              <Mail size={18} />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            </div>
          </Field>
          <Field label="Contrasena" required>
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          <Button type="submit" busy={busy} icon={<ArrowRight size={18} />}>Iniciar sesion</Button>
        </form>
        <p className="login-footer">© 2026 {branding.institution_name}</p>
      </section>
    </main>
  );
}
