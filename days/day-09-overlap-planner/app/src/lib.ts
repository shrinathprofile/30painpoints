// Pure logic only — no React/DOM imports, so `node selfcheck.ts` can execute it.
// Zero date libraries: every timezone answer comes from Intl.DateTimeFormat,
// asked PER INSTANT so DST is the platform's problem, not ours.

export type Person = {
  name: string;
  zone: string; // IANA zone — validated by isValidZone, never trusted raw
  start: number; // minutes since their local midnight
  end: number; // minutes since their local midnight; start < end (no overnight shifts)
};

// Pinned locale + h23 cycle: formatToParts output must be locale-stable and
// 24-hour everywhere — an unpinned 12h locale reintroduces "24"/dayPeriod ghosts.
// ponytail: one formatter per zone cached forever — Intl construction is the cost, formatting is cheap
const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fmts.set(tz, f);
  }
  return f;
}

export type Wall = { y: number; mo: number; d: number; h: number; mi: number };

// Trust boundary: `tz` came from user input. Intl throws RangeError on a bogus
// zone — isValidZone is the gate; everything downstream may assume a real zone.
export function isValidZone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

export function wallTime(tz: string, at: Date): Wall {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

export function wallMinutes(tz: string, at: Date): number {
  const w = wallTime(tz, at);
  return w.h * 60 + w.mi;
}

// UTC offset in minutes at one instant (+330 Kolkata, −300 NY in winter).
// Reconstruct the wall time as-if-UTC and subtract the real instant — the
// epoch-shift trick, all Intl, no libraries. DST included, per-instant.
export function zoneOffsetMin(tz: string, at: Date): number {
  const w = wallTime(tz, at);
  const asUTC = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, at.getSeconds());
  return Math.round((asUTC - at.getTime()) / 60000);
}

// "UTC+5:30" / "UTC−7" / "UTC+14"
export function fmtOffset(min: number): string {
  const sign = min < 0 ? "−" : "+";
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

// minutes since midnight → "09:30"
export function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// "09:30" (the native <input type=time> value) → minutes, strictly.
// One exception the input can never produce but the wire format needs:
// "24:00" = end of day (ISO 8601) — encodeState writes it for end=1440, so
// parseHHMM must read it back or a 00:00–24:00 person can't survive a share.
export function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h === 24 && mi === 0) return 1440;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// --- city aliases: the complaint's users think in cities, Intl thinks in zones ---

// ponytail: ~90 hand-curated aliases, not a geocoding dataset — a wrong city name
// falls through to the searchable IANA list; grow the table when a report names one we miss
export const CITY_ALIASES: Record<string, string> = {
  // north america
  "san francisco": "America/Los_Angeles",
  sf: "America/Los_Angeles",
  seattle: "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  denver: "America/Denver",
  phoenix: "America/Phoenix",
  chicago: "America/Chicago",
  austin: "America/Chicago",
  dallas: "America/Chicago",
  houston: "America/Chicago",
  "new york": "America/New_York",
  nyc: "America/New_York",
  boston: "America/New_York",
  toronto: "America/Toronto",
  vancouver: "America/Vancouver",
  honolulu: "Pacific/Honolulu",
  anchorage: "America/Anchorage",
  "mexico city": "America/Mexico_City",
  // south america
  "sao paulo": "America/Sao_Paulo",
  "buenos aires": "America/Argentina/Buenos_Aires",
  santiago: "America/Santiago",
  bogota: "America/Bogota",
  lima: "America/Lima",
  // europe
  london: "Europe/London",
  dublin: "Europe/Dublin",
  lisbon: "Europe/Lisbon",
  madrid: "Europe/Madrid",
  paris: "Europe/Paris",
  berlin: "Europe/Berlin",
  munich: "Europe/Berlin",
  amsterdam: "Europe/Amsterdam",
  brussels: "Europe/Brussels",
  zurich: "Europe/Zurich",
  vienna: "Europe/Vienna",
  stockholm: "Europe/Stockholm",
  copenhagen: "Europe/Copenhagen",
  oslo: "Europe/Oslo",
  helsinki: "Europe/Helsinki",
  warsaw: "Europe/Warsaw",
  prague: "Europe/Prague",
  budapest: "Europe/Budapest",
  bucharest: "Europe/Bucharest",
  athens: "Europe/Athens",
  kyiv: "Europe/Kyiv",
  istanbul: "Europe/Istanbul",
  rome: "Europe/Rome",
  milan: "Europe/Rome",
  moscow: "Europe/Moscow",
  // africa + middle east
  dubai: "Asia/Dubai",
  "abu dhabi": "Asia/Dubai",
  riyadh: "Asia/Riyadh",
  doha: "Asia/Qatar",
  "tel aviv": "Asia/Tel_Aviv",
  cairo: "Africa/Cairo",
  lagos: "Africa/Lagos",
  nairobi: "Africa/Nairobi",
  accra: "Africa/Accra",
  johannesburg: "Africa/Johannesburg",
  casablanca: "Africa/Casablanca",
  // south asia
  mumbai: "Asia/Kolkata",
  delhi: "Asia/Kolkata",
  "new delhi": "Asia/Kolkata",
  bengaluru: "Asia/Kolkata",
  bangalore: "Asia/Kolkata",
  hyderabad: "Asia/Kolkata",
  chennai: "Asia/Kolkata",
  pune: "Asia/Kolkata",
  kolkata: "Asia/Kolkata",
  colombo: "Asia/Colombo",
  karachi: "Asia/Karachi",
  islamabad: "Asia/Karachi",
  dhaka: "Asia/Dhaka",
  kathmandu: "Asia/Kathmandu",
  // east + southeast asia + oceania
  bangkok: "Asia/Bangkok",
  singapore: "Asia/Singapore",
  jakarta: "Asia/Jakarta",
  bali: "Asia/Makassar",
  "kuala lumpur": "Asia/Kuala_Lumpur",
  manila: "Asia/Manila",
  "ho chi minh": "Asia/Ho_Chi_Minh",
  saigon: "Asia/Ho_Chi_Minh",
  "hong kong": "Asia/Hong_Kong",
  shanghai: "Asia/Shanghai",
  beijing: "Asia/Shanghai",
  taipei: "Asia/Taipei",
  seoul: "Asia/Seoul",
  tokyo: "Asia/Tokyo",
  osaka: "Asia/Tokyo",
  sydney: "Australia/Sydney",
  melbourne: "Australia/Melbourne",
  brisbane: "Australia/Brisbane",
  perth: "Australia/Perth",
  auckland: "Pacific/Auckland",
  wellington: "Pacific/Auckland",
  christchurch: "Pacific/Auckland",
};

export const ZONES: readonly string[] = Intl.supportedValuesOf("timeZone");

export type PlaceResult = { ok: true; zone: string; label: string } | { ok: false; error: string };

// Trust boundary: free text in, IANA zone out. Input is Unicode-folded first
// (NFD + mark-strip + lowercase) so "São Paulo"/"İstanbul" hit their ASCII
// aliases instead of a misleading refusal (adversarial F5 — İ.toLowerCase()
// yields i+combining-dot, which the mark-strip then eats). Alias → exact zone →
// unique zone-suffix → anything Intl itself accepts (the list omits "UTC" and
// picks link spellings like Asia/Calcutta — the parser is the authority, not
// the list) → refuse. The refusal names what to do, never guesses.
function fold(input: string): string {
  return input
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function resolvePlace(input: string, zones: readonly string[] = ZONES): PlaceResult {
  const s = fold(input);
  if (!s) return { ok: false, error: "type a city or timezone" };
  const alias = CITY_ALIASES[s];
  if (alias) return { ok: true, zone: alias, label: input.trim() };
  const exact = zones.find((z) => z.toLowerCase() === s);
  if (exact) return { ok: true, zone: exact, label: exact };
  const suffix = zones.filter((z) => z.toLowerCase().endsWith(`/${s}`));
  if (suffix.length === 1) return { ok: true, zone: suffix[0], label: suffix[0] };
  if (suffix.length > 1)
    return { ok: false, error: `"${input.trim()}" matches ${suffix.length} zones — type more (e.g. ${suffix[0]})` };
  if (isValidZone(input.trim())) return { ok: true, zone: input.trim(), label: input.trim() };
  return { ok: false, error: `"${input.trim()}" isn't in the list — pick a suggestion` };
}

// --- the overlap arithmetic ---

// The first existing instant of `at`'s local calendar day in `tz`. Walk forward
// from the naive guess in 15-min steps to the first instant whose wall DATE is
// the target — handles both the common case (lands on 00:00 exactly) and the
// five zone/dates a year where a DST jump swallows midnight whole (2026 probed:
// Havana, Santiago, Azores anchor 01:00; Beirut, Cairo likewise) and the naive
// iteration would oscillate onto the previous day (adversarial F2).
export function dayStart(tz: string, at: Date): Date {
  const w = wallTime(tz, at);
  const naive = Date.UTC(w.y, w.mo - 1, w.d) - zoneOffsetMin(tz, at) * 60000;
  for (let t = naive; t <= naive + 3 * 3600_000; t += 15 * 60_000) {
    const d = new Date(t);
    const x = wallTime(tz, d);
    if (x.y === w.y && x.mo === w.mo && x.d === w.d) return d;
  }
  return new Date(naive); // unreachable for real zones (418 zones × 2026 probed)
}

// One viewer-local day as `slotMin` real instants from local midnight.
// ponytail: exactly 24*60/slotMin REAL slots — on the anchor zone's 2 DST days a
// year the local day is 23/25 real hours, so a fall-back day's last local hour
// is off the grid and a spring-forward day bleeds into tomorrow; per-instant
// cell truth is unaffected. Exact local-day span when someone plans on a
// transition day (adversarial F1).
export function daySlots(tz: string, at: Date, slotMin: number): Date[] {
  const start = dayStart(tz, at);
  const n = (24 * 60) / slotMin;
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * slotMin * 60000));
}

// Is each instant inside this person's working hours, by THEIR wall clock?
export function workingMask(p: Person, instants: Date[]): boolean[] {
  return instants.map((at) => {
    const m = wallMinutes(p.zone, at);
    return m >= p.start && m < p.end;
  });
}

// Columns where EVERYONE is working, as [startIdx, endIdx) slot ranges.
// Empty team → no bands: `[].every()` is true, and "works for all 0" is a lie.
export function fairBands(masks: boolean[][], slotCount: number): Array<[number, number]> {
  const bands: Array<[number, number]> = [];
  let runStart = -1;
  for (let j = 0; j <= slotCount; j++) {
    const all = j < slotCount && masks.length > 0 && masks.every((m) => m[j]);
    if (all && runStart < 0) runStart = j;
    if (!all && runStart >= 0) {
      bands.push([runStart, j]);
      runStart = -1;
    }
  }
  return bands;
}

// Row-level validation — the App renders the error, the check suite proves it.
export function validatePerson(p: Person): string | null {
  if (!isValidZone(p.zone)) return "unknown timezone";
  if (p.end <= p.start) return "end must be after start (overnight shifts not supported)";
  return null;
}

// --- shareable state: #v=1|name|zone|HH:MM|HH:MM,... ---
// Every FIELD is percent-encoded before joining, and the separators themselves
// (| and ,) are chars encodeURIComponent ALWAYS escapes (~ ! * ' ( ) are NOT —
// learned by execution) — so a name containing separators can't corrupt the
// format, and a hand-edited hash with a bad escape decodes to null, never to a
// silently-wrong team.
// Lone surrogates make encodeURIComponent THROW (URIError) — the decode path
// guards every step, so the encode path must not be the crash (adversarial F4).
// Strip them (U+FFFD replaces), and cap at 40 runes HERE too — decode caps, so
// encode must write only what decode keeps, or a roundtrip silently mutates (F6).
function cleanName(name: string): string {
  const wellFormed = name.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  return Array.from(wellFormed).slice(0, 40).join("");
}

export function encodeState(people: Person[]): string {
  const body = people
    .map((p) => [cleanName(p.name), p.zone, fmtMin(p.start), fmtMin(p.end)].map(encodeURIComponent).join("|"))
    .join(",");
  return `v=1|${body}`;
}

export function decodeState(hash: string): Person[] | null {
  const raw = hash.replace(/^#/, "");
  if (!raw) return null;
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!s.startsWith("v=1|")) return null;
  const people: Person[] = [];
  for (const row of s.slice(4).split(",")) {
    const f = row.split("|");
    if (f.length !== 4) return null;
    let name: string, zone: string, startS: string, endS: string;
    try {
      // map's extra (index, array) args are ignored by decodeURIComponent
      [name, zone, startS, endS] = f.map(decodeURIComponent) as [string, string, string, string];
    } catch {
      return null;
    }
    const start = parseHHMM(startS);
    const end = parseHHMM(endS);
    if (start === null || end === null || end <= start) return null; // overnight teams are refused by validatePerson — a share link must not smuggle one in (adversarial F3)
    if (!isValidZone(zone)) return null;
    // Array.from: cap by rune, never slice a surrogate pair in half
    people.push({ name: Array.from(name).slice(0, 40).join(""), zone, start, end });
  }
  return people;
}
