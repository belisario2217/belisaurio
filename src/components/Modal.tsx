import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  title,
  children,
  onClose,
  size = "medium",
  className = ""
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "small" | "medium" | "large";
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal-${size} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar" title="Cerrar"><X size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
