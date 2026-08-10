export const API_BASE = (import.meta.env.VITE_GTFS_API_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, "");
const API_TOKEN_STORAGE_KEY = "gtfs-studio-api-token";

export function loadApiToken(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(API_TOKEN_STORAGE_KEY) ?? "";
}

export function saveApiToken(token: string): void {
  if (typeof window === "undefined") return;
  const value = token.trim();
  if (value) window.sessionStorage.setItem(API_TOKEN_STORAGE_KEY, value);
  else window.sessionStorage.removeItem(API_TOKEN_STORAGE_KEY);
}

function withApiToken(init: RequestInit = {}): RequestInit {
  const token = loadApiToken().trim();
  if (!token) return init;
  const headers = new Headers(init.headers);
  if (!headers.has("authorization") && !headers.has("x-api-token")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, withApiToken(init));
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
