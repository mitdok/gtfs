export const API_BASE = (import.meta.env.VITE_GTFS_API_BASE_URL ?? "http://localhost:8787").replace(/\/+$/, "");

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}
