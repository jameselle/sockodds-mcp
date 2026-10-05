import { readFileSync } from "node:fs";

export const ROOT = new URL("../../", import.meta.url);

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, ROOT), "utf8")) as T;
}

/** A fake fetch that records calls and replies from a queue. */
export function fakeFetch(replies: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const r = replies.length > 1 ? replies.shift()! : replies[0];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fn, calls };
}
