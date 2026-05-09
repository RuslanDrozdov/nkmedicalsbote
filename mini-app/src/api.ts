import WebApp from "@twa-dev/sdk";

const FETCH_TIMEOUT_MS = 30_000;

function initDataHeader(): string {
  if (typeof window === "undefined") return "";
  const fromSdk = WebApp.initData;
  if (typeof fromSdk === "string" && fromSdk.length > 0) return fromSdk;
  const fromWindow = window.Telegram?.WebApp?.initData;
  return typeof fromWindow === "string" ? fromWindow : "";
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  const merged: RequestInit = { ...init, signal: controller.signal };
  return fetch(input, merged).finally(() => clearTimeout(t));
}

export async function apiGet<T>(path: string): Promise<T> {
  let r: Response;
  try {
    r = await fetchWithTimeout(
      path,
      {
        headers: { "X-Telegram-Init-Data": initDataHeader() },
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!r.ok) {
    const err = body as { error?: string };
    throw new Error(err?.error ?? `HTTP ${r.status}`);
  }
  return body as T;
}

export async function apiPost<T>(path: string, json: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetchWithTimeout(
      path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initDataHeader(),
        },
        body: JSON.stringify(json),
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!r.ok) {
    const err = body as { error?: string };
    throw new Error(err?.error ?? `HTTP ${r.status}`);
  }
  return body as T;
}
