import { ApiError } from "../utils.js";

// Conserva al menos cuatro dígitos y continúa con 10000, 10001, etc. sin un tope numérico.
export function normalizePhysicalFolio(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw) || !/[1-9]/.test(raw)) {
    throw new ApiError(400, "El número de folio físico debe contener únicamente dígitos y ser mayor que cero.");
  }
  const withoutLeadingZeros = raw.replace(/^0+/, "");
  return withoutLeadingZeros.padStart(4, "0");
}

export function displayPhysicalFolio(value: string | null | undefined): string {
  try {
    return normalizePhysicalFolio(value);
  } catch {
    return "SIN FOLIO FÍSICO";
  }
}

// No convierte los folios a Number: admite consecutivos largos sin perder precisión.
export function comparePhysicalFolios(a: string, b: string): number {
  const first = a.replace(/^0+/, "") || "0";
  const second = b.replace(/^0+/, "") || "0";
  return first.length - second.length || (first < second ? -1 : first > second ? 1 : 0);
}
