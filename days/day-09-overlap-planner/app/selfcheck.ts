// Rung 1 self-check — executed, never read-green: `node selfcheck.ts`
// (Node >= 22.18 strips types natively; no framework, no build step.)
// Every zone/gold value below was hand-verified against an INDEPENDENT clock:
//   TZ=<zone> date -r <epoch>   (shell date, not this implementation)
import {
  CITY_ALIASES,
  ZONES,
  decodeState,
  daySlots,
  dayStart,
  encodeState,
  fairBands,
  fmtMin,
  fmtOffset,
  isValidZone,
  parseHHMM,
  resolvePlace,
  validatePerson,
  wallMinutes,
  wallTime,
  workingMask,
  zoneOffsetMin,
  type Person,
} from "./src/lib.ts";

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

const JUN = new Date("2026-06-01T12:00:00Z"); // 1780315200 — shell: NY 08:00 EDT, London 13:00 BST, LH 22:30 +1030
const JAN = new Date("2026-01-15T12:00:00Z"); // 1768478400 — shell: NY 07:00 EST, London 12:00 GMT, LH 23:00 +1100

// --- wallTime: per-instant Intl, pinned en-GB h23 (gold values from shell date) ---
eq("Kolkata wall (fixed +5:30, both seasons)", [wallTime("Asia/Kolkata", JUN), wallTime("Asia/Kolkata", JAN)].map((w) => `${w.h}:${w.mi}`), ["17:30", "17:30"]);
eq("New York wall flips with DST (08:00 EDT / 07:00 EST)", [JUN, JAN].map((d) => wallMinutes("America/New_York", d)), [480, 420]);
eq("London wall flips with DST (13:00 BST / 12:00 GMT)", [JUN, JAN].map((d) => wallTime("Europe/London", d).h), [13, 12]);
eq("Lord Howe wall (22:30 std / 23:00 DST)", [JUN, JAN].map((d) => wallTime("Australia/Lord_Howe", d).h), [22, 23]);
eq("h23 never emits hour 24 or 12h ghosts", [JUN, JAN].map((d) => wallTime("Pacific/Kiritimati", d).h), [2, 2]);
eq("wall date rolls (12:00Z is already Jun 2 in Kiritimati)", `${wallTime("Pacific/Kiritimati", JUN).mo}-${wallTime("Pacific/Kiritimati", JUN).d}`, "6-2");
eq("wallMinutes agrees with wallTime", wallMinutes("Asia/Kolkata", JUN), 17 * 60 + 30);

// --- zoneOffsetMin: the epoch-shift trick, gold offsets from shell %z ---
eq("Kolkata +330 both seasons", [zoneOffsetMin("Asia/Kolkata", JUN), zoneOffsetMin("Asia/Kolkata", JAN)], [330, 330]);
eq("New York −240 EDT / −300 EST", [zoneOffsetMin("America/New_York", JUN), zoneOffsetMin("America/New_York", JAN)], [-240, -300]);
eq("London +60 BST / 0 GMT", [zoneOffsetMin("Europe/London", JUN), zoneOffsetMin("Europe/London", JAN)], [60, 0]);
eq("Lord Howe +630 std / +660 DST (30-minute DST!)", [zoneOffsetMin("Australia/Lord_Howe", JUN), zoneOffsetMin("Australia/Lord_Howe", JAN)], [630, 660]);
eq("Kiritimati +1400 always", [zoneOffsetMin("Pacific/Kiritimati", JUN), zoneOffsetMin("Pacific/Kiritimati", JAN)], [840, 840]);
eq("seconds in the instant don't corrupt the offset", zoneOffsetMin("Asia/Kolkata", new Date("2026-01-15T12:00:30Z")), 330);
eq("offset stays whole minutes at :30 instants", zoneOffsetMin("Asia/Kathmandu", new Date("2026-01-15T12:00:30Z")), 345);

// --- fmt helpers ---
eq("fmtOffset +half-hour / −whole / +14", [fmtOffset(330), fmtOffset(-300), fmtOffset(840), fmtOffset(0)], ["UTC+5:30", "UTC−5", "UTC+14", "UTC+0"]);
eq("fmtMin pads", [fmtMin(570), fmtMin(0), fmtMin(1439)], ["09:30", "00:00", "23:59"]);

// --- parseHHMM: native <input type=time> values, strict ---
eq("parse 09:30", parseHHMM("09:30"), 570);
eq("parse tolerates surrounding spaces", parseHHMM(" 17:00 "), 1020);
eq("24:00 accepted ONLY as ISO end-of-day (wire-format end bound)", parseHHMM("24:00"), 1440);
eq("reject 24:30 (only the exact end-of-day pair passes)", parseHHMM("24:30"), null);
eq("reject 25:00", parseHHMM("25:00"), null);
eq("reject 09:60", parseHHMM("09:60"), null);
eq("reject 9:30 (input=time never sends this, strictness is the guard)", parseHHMM("9:30"), null);
eq("reject empty", parseHHMM(""), null);

// --- resolvePlace: trust boundary (free text → zone) ---
eq("alias Bengaluru", resolvePlace("Bengaluru"), { ok: true, zone: "Asia/Kolkata", label: "Bengaluru" });
eq("alias case-insensitive BANGALORE", resolvePlace("BANGALORE"), { ok: true, zone: "Asia/Kolkata", label: "BANGALORE" });
eq("alias with spaces 'new york'", resolvePlace("New York"), { ok: true, zone: "America/New_York", label: "New York" });
eq("exact zone kept as typed", resolvePlace("America/Los_Angeles"), { ok: true, zone: "America/Los_Angeles", label: "America/Los_Angeles" });
eq("exact zone case-insensitive", resolvePlace("europe/london"), { ok: true, zone: "Europe/London", label: "Europe/London" });
eq("alias 'Kolkata' → Asia/Kolkata", resolvePlace("Kolkata"), { ok: true, zone: "Asia/Kolkata", label: "Kolkata" });
{
  // suffix matching picks whatever spelling the ENGINE's list carries (Node lists
  // Asia/Calcutta; a browser may list Asia/Kolkata) — assert the semantics, not the spelling
  const c = resolvePlace("Calcutta");
  eq("suffix 'Calcutta' resolves to a valid Kolkata-time zone", c.ok === true && isValidZone(c.zone) && wallMinutes(c.zone, JAN) === 17 * 60 + 30, true);
}
eq("list-omitted spelling still accepted via Intl fallback", resolvePlace("Asia/Kolkata").ok, true);
eq("'UTC' works though absent from supportedValuesOf", resolvePlace("UTC"), { ok: true, zone: "UTC", label: "UTC" });
eq("'Etc/GMT+5' accepted (Intl semantics; offset shown is computed, not parsed)", resolvePlace("Etc/GMT+5").ok, true);
eq("garbage refused with guidance", resolvePlace("Narnia"), { ok: false, error: '"Narnia" isn\'t in the list — pick a suggestion' });
eq("empty refused", resolvePlace("   "), { ok: false, error: "type a city or timezone" });
{
  // the ambiguity branch is unreachable in Node's 418-zone list (probed: 0 shared
  // final segments) — prove it anyway with an injected list that HAS a clash.
  // "tycho" is not a CITY_ALIAS, so the suffix branch is what runs.
  const fake = ["Asia/Tycho", "America/Tycho"];
  eq("ambiguous suffix asks for more typing, never guesses", resolvePlace("tycho", fake), {
    ok: false,
    error: '"tycho" matches 2 zones — type more (e.g. Asia/Tycho)',
  });
}

// --- isValidZone gates everything Intl refuses ---
eq("valid zone", isValidZone("Asia/Kolkata"), true);
eq("bogus zone", isValidZone("Mars/Olympus"), false);
eq("empty string", isValidZone(""), false);
eq("zone with newline injection", isValidZone("Asia/Kolkata\n"), false);

// --- dayStart / daySlots: hand-derived anchors ---
eq("Kolkata day start: 12:00Z wall 17:30 → 18:30Z prev day", dayStart("Asia/Kolkata", JAN).toISOString(), "2026-01-14T18:30:00.000Z");
eq("New York day start (winter): → 05:00Z", dayStart("America/New_York", JAN).toISOString(), "2026-01-15T05:00:00.000Z");
eq("Kiritimati day start wraps: wall date is already Jan 16 (+14) → 10:00Z Jan 15", dayStart("Pacific/Kiritimati", JAN).toISOString(), "2026-01-15T10:00:00.000Z");
{
  const slots = daySlots("Asia/Kolkata", JAN, 30);
  eq("48 half-hour slots per day", slots.length, 48);
  eq("first slot IS the day start", slots[0].toISOString(), "2026-01-14T18:30:00.000Z");
  eq("last slot starts 23:30 local", slots[47].toISOString(), "2026-01-15T18:00:00.000Z");
  eq("slots are real instants (equal spacing)", slots[24].getTime() - slots[0].getTime(), 12 * 3600_000);
}

// --- workingMask + fairBands: the overlap arithmetic, hand-computed ---
{
  // Jan: London 9–17 = 09:00Z–17:00Z; Kolkata 9–17 = 03:30Z–11:30Z.
  // Grid anchored at Kolkata's local day (18:30Z Jan 14): fair = 09:00Z–11:30Z.
  const slots = daySlots("Asia/Kolkata", JAN, 30);
  const london: Person = { name: "London", zone: "Europe/London", start: 540, end: 1020 };
  const bengaluru: Person = { name: "Bengaluru", zone: "Asia/Kolkata", start: 540, end: 1020 };
  const mLondon = workingMask(london, slots);
  const mBeng = workingMask(bengaluru, slots);
  eq("London green exactly slots 29..44", [mLondon.indexOf(true), mLondon.lastIndexOf(true)], [29, 44]);
  eq("Bengaluru green exactly slots 18..33", [mBeng.indexOf(true), mBeng.lastIndexOf(true)], [18, 33]);
  const bands = fairBands([mLondon, mBeng], slots.length);
  eq("one fair band [29,34)", bands, [[29, 34]]);
  eq("band reads 09:00Z–11:30Z", `${slots[bands[0][0]].toISOString()}→${slots[bands[0][1]].toISOString()}`, "2026-01-15T09:00:00.000Z→2026-01-15T11:30:00.000Z");
  eq("band is 5 slots (2.5h)", bands[0][1] - bands[0][0], 5);

  // June: London BST shifts ITS window to 08:00Z–16:00Z; Kolkata fixed.
  // Same pair, no DST code of ours, band start moves 09:00Z → 08:00Z.
  const jSlots = daySlots("Asia/Kolkata", JUN, 30);
  const jBands = fairBands([workingMask(london, jSlots), workingMask(bengaluru, jSlots)], jSlots.length);
  eq("June band starts 08:00Z (DST moved it, free via Intl)", jSlots[jBands[0][0]].toISOString(), "2026-06-01T08:00:00.000Z");
  eq("June band still ends 11:30Z", jSlots[jBands[0][1]].toISOString(), "2026-06-01T11:30:00.000Z");

  // SF + London 9–17 in winter never touch (17:00Z vs 17:00Z) — the honest empty.
  const sf: Person = { name: "SF", zone: "America/Los_Angeles", start: 540, end: 1020 };
  eq("SF+London winter: zero fair window, stated not fudged", fairBands([workingMask(sf, slots), mLondon], slots.length), []);

  // three people: SF(9-17) + Kolkata(9-17) + London(9-17) → empty; drop London → still empty
  eq("SF+Kolkata empty too", fairBands([workingMask(sf, slots), mBeng], slots.length), []);
}
{
  // zero teammates: `[].every()` is true — "works for all 0" would be a lie
  eq("empty team → no bands", fairBands([], 48), []);
  // single person full-day band
  const allDay: Person = { name: "you", zone: "UTC", start: 0, end: 1440 };
  const slots = daySlots("UTC", JAN, 60);
  eq("24h person → one band covering the day", fairBands([workingMask(allDay, slots)], 24), [[0, 24]]);
}

// --- validatePerson ---
eq("end == start refused", validatePerson({ name: "x", zone: "UTC", start: 540, end: 540 }), "end must be after start (overnight shifts not supported)");
eq("end < start refused", validatePerson({ name: "x", zone: "UTC", start: 1020, end: 540 }), "end must be after start (overnight shifts not supported)");
eq("valid person passes", validatePerson({ name: "x", zone: "Asia/Kolkata", start: 570, end: 1110 }), null);
eq("bogus zone caught", validatePerson({ name: "x", zone: "nope", start: 540, end: 1020 }), "unknown timezone");

// --- share state: encode → decode roundtrip + hostile hashes ---
{
  const people: Person[] = [
    { name: "You", zone: "Asia/Kolkata", start: 570, end: 1110 },
    { name: "Sam | HQ ~ evil", zone: "America/New_York", start: 540, end: 1020 },
    { name: "李明", zone: "Asia/Shanghai", start: 540, end: 1020 },
    { name: "100% | remote ~ %7C", zone: "UTC", start: 0, end: 1440 },
  ];
  const hash = encodeURIComponent(encodeState(people));
  eq("roundtrip preserves names (separators!), zones, minutes", JSON.stringify(decodeState(hash)), JSON.stringify(people));
  eq("hash is injective: encode(decode(hash)) === hash", decodeState(hash) && encodeURIComponent(encodeState(decodeState(hash)!)), hash);
  eq("decode empty hash → null (boot defaults)", decodeState(""), null);
  eq("decode garbage → null, never crash", decodeState("garbage"), null);
  eq("decode wrong version → null", decodeState(encodeURIComponent("v=2|x")), null);
  eq("decode truncated row → null", decodeState(encodeURIComponent("v=1|You|Asia/Kolkata|570")), null);
  eq("decode bad zone → null", decodeState(encodeURIComponent("v=1|You|Mars|570|1110")), null);
  eq("decode bad time → null", decodeState(encodeURIComponent("v=1|You|UTC|24:00|1110")), null);
  eq("decode percent-escape garbage → null", decodeState("%zz"), null);
  eq("decode 40-char name cap is non-destructive when short", decodeState(encodeURIComponent("v=1|ab|UTC|09:00|17:00"))?.[0]?.name, "ab");
}

// --- structural platform facts the UI leans on (probed, not assumed) ---
eq("supportedValuesOf returns a real IANA list (>300)", ZONES.length > 300, true);
eq("aliases all point at zones Intl accepts", Object.values(CITY_ALIASES).every((z) => isValidZone(z)), true);
eq("alias count is hand-sized, not a dataset", Object.keys(CITY_ALIASES).length < 120, true);

// --- adversarial regressions (F1–F6, fresh-context pass) ---
{
  // F2: swallowed-midnight spring-forward — the old 2-round iteration anchored
  // Havana/Santiago/Azores at 23:00 of the PREVIOUS day; Beirut/Cairo were fine
  const MAR8 = new Date("2026-03-08T12:00:00Z");
  for (const [z, mo, d] of [
    ["America/Havana", 3, 8],
    ["America/Santiago", 9, 6],
    ["Atlantic/Azores", 3, 29],
    ["Asia/Beirut", 3, 29],
    ["Africa/Cairo", 4, 24],
  ] as const) {
    const at = new Date(Date.UTC(2026, mo - 1, d, 12));
    const w = wallTime(z, dayStart(z, at));
    eq(`F2 ${z} day-start lands ON the target date (${w.d === d ? "yes" : "NO"})`, [w.mo, w.d], [mo, d]);
  }
  eq("F2 Havana day-start is the first existing instant (01:00, not prev-day 23:00)", (() => {
    const w = wallTime("America/Havana", dayStart("America/Havana", MAR8));
    return `${w.d}T${w.h}:${String(w.mi).padStart(2, "0")}`;
  })(), "8T1:00");

  // F3: a share link must not smuggle in a team the validator refuses
  eq("F3 decode rejects end<=start (overnight) rows", decodeState(encodeURIComponent("v=1|Night|UTC|18:00|09:00")), null);
  eq("F3 decode rejects start==end rows", decodeState(encodeURIComponent("v=1|Stuck|UTC|09:00|09:00")), null);

  // F4: lone surrogates made encodeState THROW (URIError) — decode guards, encode didn't
  eq("F4 lone-surrogate name encodes, not throws", (() => {
    const h = encodeURIComponent(encodeState([{ name: "a\uD800b", zone: "UTC", start: 540, end: 1020 }]));
    return decodeState(h)?.[0]?.name.includes("\uFFFD");
  })(), true);

  // F5: diacritic spellings of aliased cities resolved to misleading refusals
  eq("F5 'São Paulo' (NFC) resolves", resolvePlace("São Paulo").ok, true);
  eq("F5 'São Paulo' (NFD) resolves", resolvePlace("São Paulo".normalize("NFD")).ok, true);
  eq("F5 'İstanbul' (Turkish dotted İ) resolves", resolvePlace("İstanbul").ok, true);

  // F6: encode wrote 41 runes, decode kept 40 — roundtrip mutated the team
  eq("F6 41-rune name round-trips to the SAME (capped) team", (() => {
    const p: Person[] = [{ name: "x".repeat(41), zone: "UTC", start: 540, end: 1020 }];
    const once = decodeState(encodeURIComponent(encodeState(p)))!;
    const twice = decodeState(encodeURIComponent(encodeState(once)))!;
    return JSON.stringify(once) === JSON.stringify(twice) && once[0].name.length === 40;
  })(), true);
}

console.log(`\n${pass + fail} checks: ${pass} green, ${fail} red`);
if (fail > 0) process.exit(1);
