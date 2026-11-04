// Pure logic only — no React/DOM imports, so `node selfcheck.ts` can execute it.
export const DEVICES = [
  { w: 320, name: "iPhone SE" },
  { w: 390, name: "iPhone 15" },
  { w: 412, name: "Pixel 8" },
  { w: 768, name: "iPad" },
  { w: 1280, name: "laptop" },
] as const;

// ponytail: fixed 40,000px frame height — a page taller than this is cut off at the bottom; make it a per-load input when someone hits a real page's tail
export const FRAME_H = 40_000;

export const ZOOMS = [0.25, 0.33, 0.5, 0.75, 1] as const;

// localhost / 127.x / [::1] hosts get http:// (dev servers have no TLS); everything else https://.
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^/]*\.localhost)(:\d+)?([/?#].*)?$/i;

// A real scheme is written with `//`. A bare `name:` is either a non-http scheme (mailto:,
// javascript:) or host:port — and a port is digits, which is what tells them apart.
const EXPLICIT = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const HOST_PORT = /^[a-zA-Z][a-zA-Z0-9.-]*:\d+(?=[/?#]|$)/;
const BARE_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

// Trust boundary: the returned string becomes an iframe src — only http(s) may pass,
// with no credentials and no internal whitespace (which browsers silently mangle).
export function normalizeUrl(input: string): UrlResult {
  const s = input.trim();
  if (!s) return { ok: false, error: "type a URL first" };
  // Chromium percent-encodes spaces inside hosts (Node throws) — refuse them ourselves so
  // behavior is identical everywhere and a pasted newline can't silently change the target.
  // oxlint-disable-next-line no-control-regex — matching control characters is the point
  if (/[\s\u0000-\u001F\u007F]/.test(s)) {
    return { ok: false, error: "URLs can't contain spaces or line breaks" };
  }
  const explicit = EXPLICIT.test(s);
  if (!explicit && !HOST_PORT.test(s)) {
    const bare = BARE_SCHEME.exec(s);
    if (bare) return { ok: false, error: `only http(s) URLs can be framed, not ${bare[1]}:` };
  }
  let u: URL;
  try {
    u = new URL(explicit ? s : `${LOCAL.test(s) ? "http" : "https"}://${s}`);
  } catch {
    return { ok: false, error: `"${s}" is not a valid URL` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `only http(s) URLs can be framed, not ${u.protocol}` };
  }
  // Browsers refuse to frame credentialed URLs anyway; strip so the secret never reaches
  // the iframe src, the ↗ link, or the shareable location.hash.
  u.username = "";
  u.password = "";
  return { ok: true, url: u.href };
}
