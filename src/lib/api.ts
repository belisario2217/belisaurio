const TOKEN_KEY = "aula-nova-token";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function publicFileUrl(filePath: string) {
  if (/^(?:https?:)?\/\//i.test(filePath) || filePath.startsWith("data:") || filePath.startsWith("blob:")) return filePath;
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  if (!API_BASE_URL.startsWith("http://") && !API_BASE_URL.startsWith("https://")) return normalized;
  return new URL(normalized, API_BASE_URL).toString();
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | unknown[];
};

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(apiUrl(path), { ...options, headers, body: body as BodyInit });
  if (response.status === 401 && path !== "/auth/login") {
    setToken(null);
    if (!/^\/verificar-(documento|credencial)\//.test(window.location.pathname)) window.location.assign("/login");
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "No fue posible completar la solicitud." }));
    throw new Error(error.message || "No fue posible completar la solicitud.");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function download(path: string, filename: string) {
  const token = getToken();
  const response = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "No fue posible generar el archivo." }));
    throw new Error(error.message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function openDocument(path: string) {
  const token = getToken();
  const preview = window.open("about:blank", "_blank");
  if (preview) {
    preview.opener = null;
    preview.document.title = "Preparando documento";
    preview.document.body.textContent = "Preparando el documento para impresión…";
  }
  try {
    const response = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (!response.ok) throw new Error((await response.json()).message);
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.replace(url);
    else {
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "documento.pdf";
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { preview?.close(); throw error; }
}
