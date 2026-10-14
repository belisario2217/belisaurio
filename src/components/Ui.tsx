import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";

export function Button({
  children,
  icon,
  variant = "primary",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
}) {
  return (
    <button className={`button button-${variant}`} {...props} disabled={props.disabled || busy}>
      {busy ? <LoaderCircle className="spin" size={17} /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function Field({
  label,
  required,
  hint,
  children
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}{required && <b aria-hidden="true"> *</b>}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Select({
  options,
  placeholder = "Seleccionar",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ id: string | number; name: string; sequence?: number }>;
  placeholder?: string;
}) {
  return (
    <select {...props}>
      <option value="">{placeholder}</option>
      {[...options].sort((a, b) => a.sequence != null && b.sequence != null ? a.sequence - b.sequence : a.name.localeCompare(b.name, "es-MX", { sensitivity: "base", numeric: true })).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  );
}

export function LoadingState({ label = "Cargando información" }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite"><LoaderCircle className="spin" size={24}/><span>{label}</span><div className="loading-skeleton"/></div>;
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

export function StatusBadge({ active, label }: { active?: boolean; label?: string }) {
  return <span className={`status-badge ${active ? "status-active" : "status-inactive"}`}>{label ?? (active ? "Activo" : "Inactivo")}</span>;
}
