// Rung 1 self-check — executed, never read-green: `node selfcheck.ts`
// (Node >= 22.18 strips types natively; no framework, no build step.)
import { DEVICES, ZOOMS, normalizeUrl } from "./src/lib.ts";

let pass = 0;
let fail = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`ok   ${label}`);
  } else {
    fail++;
    console.log(`FAIL ${label}\n     expected ${e}\n     actual   ${a}`);
  }
}

// --- normalizeUrl: the trust boundary (return value becomes an iframe src) ---
eq("bare domain → https", normalizeUrl("example.com"), { ok: true, url: "https://example.com/" });
eq("whitespace + explicit scheme kept", normalizeUrl("  http://x.test/a  "), {
  ok: true,
  url: "http://x.test/a",
});
eq("host:port on localhost → http", normalizeUrl("localhost:5173/demo.html"), {
  ok: true,
  url: "http://localhost:5173/demo.html",
});
eq("bare localhost → http", normalizeUrl("localhost"), { ok: true, url: "http://localhost/" });
eq("UPPERCASE localhost → http", normalizeUrl("LOCALHOST:5173"), {
  ok: true,
  url: "http://localhost:5173/",
});
eq("127.x → http", normalizeUrl("127.0.0.1:3000"), { ok: true, url: "http://127.0.0.1:3000/" });
eq("*.localhost → http", normalizeUrl("app.localhost:5173"), {
  ok: true,
  url: "http://app.localhost:5173/",
});
eq("javascript: REFUSED", normalizeUrl("javascript:alert(1)"), {
  ok: false,
  error: "only http(s) URLs can be framed, not javascript:",
});
eq("data: REFUSED", normalizeUrl("data:text/html,<script>alert(1)</script>"), {
  ok: false,
  error: "only http(s) URLs can be framed, not data:",
});
eq("mailto: REFUSED (was silently rewritten to https://mailto:…)", normalizeUrl("mailto:bill@microsoft.com"), {
  ok: false,
  error: "only http(s) URLs can be framed, not mailto:",
});
eq("ftp:// refused with scheme error", normalizeUrl("ftp://example.com"), {
  ok: false,
  error: "only http(s) URLs can be framed, not ftp:",
});
eq("empty input refused", normalizeUrl("   "), { ok: false, error: "type a URL first" });
eq("spaces refused everywhere (Chromium would percent-encode them)", normalizeUrl("not a url"), {
  ok: false,
  error: "URLs can't contain spaces or line breaks",
});
eq("embedded newline refused (was silently dropped → different site)", normalizeUrl("exa\nmple.com"), {
  ok: false,
  error: "URLs can't contain spaces or line breaks",
});
eq("credentials stripped from src/↗/hash", normalizeUrl("https://user:secret@example.com/"), {
  ok: true,
  url: "https://example.com/",
});
eq("host:port with path still host:port", normalizeUrl("example.com:8080/x"), {
  ok: true,
  url: "https://example.com:8080/x",
});
eq("IDN host punycoded", normalizeUrl("例え.jp"), { ok: true, url: "https://xn--r8jz45g.jp/" });
eq("scheme+host lowercased by URL", normalizeUrl("HTTP://X.COM"), { ok: true, url: "http://x.com/" });
eq("localhost.evil.com is NOT local", normalizeUrl("localhost.evil.com"), {
  ok: true,
  url: "https://localhost.evil.com/",
});

// --- layout invariants the UI depends on ---
eq("device widths strictly ascending", DEVICES.every((d, i) => i === 0 || DEVICES[i - 1].w < d.w), true);
eq("zooms within (0,1]", ZOOMS.every((z) => 0 < z && z <= 1), true);

console.log(`\n${pass + fail} checks: ${pass} green, ${fail} red`);
if (fail > 0) process.exit(1);
