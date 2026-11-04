import { useEffect, useRef, useState } from "react";
import { DEVICES, FRAME_H, ZOOMS, normalizeUrl } from "./lib";

// A deployed link like #https://example.com demos itself. A hand-edited hash with a
// malformed %-escape must degrade to the empty state, not take the app down.
function boot() {
  let h: string;
  try {
    h = decodeURIComponent(location.hash.replace(/^#/, ""));
  } catch {
    return { input: "", target: null, error: null };
  }
  if (!h) return { input: "", target: null, error: null };
  const r = normalizeUrl(h);
  return r.ok ? { input: h, target: r.url, error: null } : { input: h, target: null, error: r.error };
}

export default function App() {
  const [initial] = useState(boot);
  const [input, setInput] = useState(initial.input);
  const [target, setTarget] = useState<string | null>(initial.target);
  const [error, setError] = useState<string | null>(initial.error);
  const [sync, setSync] = useState(true);
  const [zoom, setZoom] = useState<number>(0.5);
  const clips = useRef<(HTMLDivElement | null)[]>([]);
  const mirroring = useRef(false);

  // Editing the hash while the tab is open loads it too (our own replaceState never fires this).
  useEffect(() => {
    const onHash = () => {
      const b = boot();
      setInput(b.input);
      setError(b.error);
      setTarget(b.target);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function load() {
    const r = normalizeUrl(input);
    setError(r.ok ? null : r.error);
    setTarget(r.ok ? r.url : null);
    if (!r.ok) return;
    history.replaceState(null, "", `#${encodeURIComponent(r.url)}`);
    for (const c of clips.current) if (c) c.scrollTop = 0;
  }

  function scrolled(i: number) {
    if (!sync || mirroring.current) return;
    const src = clips.current[i];
    if (!src) return;
    mirroring.current = true;
    for (const c of clips.current) if (c && c !== src) c.scrollTop = src.scrollTop;
    requestAnimationFrame(() => (mirroring.current = false));
  }

  function toggleSync() {
    const now = !sync;
    setSync(now);
    if (now) {
      const first = clips.current.find(Boolean);
      if (first) for (const c of clips.current) if (c) c.scrollTop = first.scrollTop;
    }
  }

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="your-site.com — load it at every width, one window"
          aria-label="URL to load"
          autoFocus
        />
        <button type="submit">Load</button>
        <label>
          <input type="checkbox" checked={sync} onChange={toggleSync} /> synced scroll
        </label>
        <label>
          zoom{" "}
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      <main className="wall">
        {DEVICES.map((d, i) => (
          <section className="col" key={d.w} style={{ width: d.w * zoom }}>
            <header>
              <span>
                {d.w}px · {d.name}
              </span>
              {target && (
                <a
                  href={target}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="open this site in a new tab"
                >
                  ↗
                </a>
              )}
            </header>
            <div
              className="clip"
              ref={(el) => {
                clips.current[i] = el;
              }}
              onScroll={() => scrolled(i)}
            >
              {target ? (
                <iframe
                  src={target}
                  title={`${d.w}px ${d.name} — ${target}`}
                  style={{ width: d.w, height: FRAME_H, zoom }}
                />
              ) : (
                <div className="hint" style={{ width: d.w, zoom }}>
                  {d.w}px column waiting for a URL
                </div>
              )}
            </div>
          </section>
        ))}
      </main>

      <footer>
        One engine, every width — this is responsive <em>layout</em> testing, not cross-browser engine
        testing. A blank frame usually means the site refuses embedding (X-Frame-Options / CSP), or is
        unreachable as framed (dev server on the wrong scheme, dead DNS) — open its ↗ to see the site's
        own answer.
        {/* ponytail: blank-frame cause not detected — no cross-browser signal exists; a guessed "blocked!" badge would sometimes point at the wrong cause, and a wrong indicator is worse than an honest range of causes */}
      </footer>
    </>
  );
}
