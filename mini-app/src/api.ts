import WebApp from "@twa-dev/sdk";

function initDataHeader(): string {
  if (typeof window === "undefined") return "";
  return WebApp.initData ?? "";
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    headers: { "X-Telegram-Init-Data": initDataHeader() },
  });
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
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initDataHeader(),
    },
    body: JSON.stringify(json),
  });
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
