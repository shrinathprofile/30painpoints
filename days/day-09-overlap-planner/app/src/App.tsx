import { Fragment, useEffect, useState } from "react";
import {
  ZONES,
  daySlots,
  decodeState,
  encodeState,
  fairBands,
  fmtMin,
  fmtOffset,
  parseHHMM,
  resolvePlace,
  validatePerson,
  wallMinutes,
  workingMask,
  zoneOffsetMin,
  type Person,
} from "./lib";

const SLOT = 30;
const N = (24 * 60) / SLOT; // 48 half-hour columns
const VIEWER = Intl.DateTimeFormat().resolvedOptions().timeZone;

// One editable row; the Person (with a real zone) is DERIVED per render — no
// duplicated state to drift. Times stay as <input type="time"> strings.
type Row = { name: string; place: string; start: string; end: string };

function resolveRow(r: Row): { person: Person | null; error: string | null; label: string } {
  const res = resolvePlace(r.place);
  if (!res.ok) return { person: null, error: res.error, label: r.place };
  const start = parseHHMM(r.start);
  const end = parseHHMM(r.end);
  if (start === null || end === null)
    return { person: null, error: "working hours incomplete", label: res.label };
  const person: Person = { name: r.name.trim() || res.label, zone: res.zone, start, end };
  const err = validatePerson(person);
  return { person: err ? null : person, error: err, label: res.label };
}

// A shared link reproduces the exact team; no hash → the viewer's own zone, 9–5.
function boot(): Row[] {
  const people = decodeState(location.hash);
  if (people && people.length > 0)
    return people.map((p) => ({ name: p.name, place: p.zone, start: fmtMin(p.start), end: fmtMin(p.end) }));
  return [{ name: "You", place: VIEWER, start: "09:00", end: "17:00" }];
}

export default function App() {
  const [rows, setRows] = useState<Row[]>(boot);
  const [now, setNow] = useState(() => new Date());

  // the now-line creeps; 30s is plenty for a meeting-planning glance
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // the share link always holds the last FULLY-valid team — a half-typed row
  // must not nuke the URL someone might be copying right now
  useEffect(() => {
    if (rows.length === 0) return;
    const people = rows.map(resolveRow);
    if (people.every((x) => x.person))
      history.replaceState(null, "", `#${encodeURIComponent(encodeState(people.map((x) => x.person!)))}`);
  }, [rows]);

  const resolved = rows.map(resolveRow);
  const usable = resolved.flatMap((x) => (x.person ? [x.person] : []));
  const slots = daySlots(VIEWER, now, SLOT);
  const rowMasks = resolved.map((x) => (x.person ? workingMask(x.person, slots) : null));
  const bands = fairBands(rowMasks.flatMap((m) => (m ? [m] : [])), N);
  const skipped = rows.length - usable.length;

  // now-line position within the anchored day, if now is inside it
  const span = slots[N - 1].getTime() + SLOT * 60_000 - slots[0].getTime();
  const frac = (now.getTime() - slots[0].getTime()) / span;
  const showNow = frac >= 0 && frac < 1;

  const viewerOff = zoneOffsetMin(VIEWER, now);

  function update(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <header>
        <h1>overlap planner</h1>
        <p>
          fair meeting windows across timezones — today in <strong>{VIEWER}</strong>, everyone's clock on one
          grid. Zero date libraries.
        </p>
      </header>

      <datalist id="tz">
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>

      <section className="team" aria-label="teammates">
        {resolved.map((x, i) => (
          <Fragment key={i}>
            <div className="team-row">
              <input
                className="name"
                value={rows[i].name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="name"
                maxLength={40}
                aria-label={`teammate ${i + 1} name`}
              />
              <input
                className="place"
                value={rows[i].place}
                onChange={(e) => update(i, { place: e.target.value })}
                placeholder="city or timezone (Bengaluru, London, SF…)"
                list="tz"
                aria-label={`teammate ${i + 1} city or timezone`}
                autoComplete="off"
              />
              <input
                type="time"
                value={rows[i].start}
                onChange={(e) => update(i, { start: e.target.value })}
                aria-label={`teammate ${i + 1} working hours start`}
              />
              <span aria-hidden="true">–</span>
              <input
                type="time"
                value={rows[i].end}
                onChange={(e) => update(i, { end: e.target.value })}
                aria-label={`teammate ${i + 1} working hours end`}
              />
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`remove teammate ${i + 1}`}>
                ✕
              </button>
            </div>
            {x.error && (
              <p className="row-error" role="alert">
                {x.error}
              </p>
            )}
          </Fragment>
        ))}
        <button className="add" onClick={() => setRows([...rows, { name: "", place: "", start: "09:00", end: "17:00" }])}>
          + add teammate
        </button>
      </section>

      <section className="bands" aria-label="fair windows">
        {rows.length === 0 ? (
          <span className="none">add a teammate to see overlaps</span>
        ) : bands.length === 0 ? (
          <span className="none">
            no window where everyone's hours overlap today{skipped === 0 ? "" : " (yet — rows below are broken)"}
          </span>
        ) : (
          bands.map(([s, e], k) => {
            const vEnd = e < N ? wallMinutes(VIEWER, slots[e]) : 1440;
            const per = usable
              .map((p) => `${p.name} ${fmtMin(wallMinutes(p.zone, slots[s]))}`)
              .join(" · ");
            const um = (d: Date) => fmtMin(d.getUTCHours() * 60 + d.getUTCMinutes());
            const utc = `${um(slots[s])}–${e < N ? um(slots[e]) : fmtMin(1440)} UTC`;
            return (
              <span className="chip" key={k}>
                <strong>
                  {fmtMin(wallMinutes(VIEWER, slots[s]))}–{fmtMin(vEnd)}
                </strong>{" "}
                for you <span className="per">({utc})</span>
                <br />
                <span className="per">{per}</span>
              </span>
            );
          })
        )}
        {skipped > 0 && (
          <p className="skipped">
            {skipped} row{skipped > 1 ? "s" : ""} not counted — fix the timezone/hours above; guessing would lie.
          </p>
        )}
      </section>

      <div className="grid-wrap">
        <div className="grid-box">
          <div className="ticks" aria-hidden="true">
            <span className="sp" />
            {Array.from({ length: 12 }, (_, h) => (
              <span key={h}>{String(h * 2).padStart(2, "0")}</span>
            ))}
          </div>
          <div className="grid">
            <div className="head">fair window</div>
            {slots.map((_, j) => (
              <div className={`cell fair${bands.some(([s, e]) => s <= j && j < e) ? " on" : ""}`} key={j} />
            ))}
            {resolved.map((x, i) => (
              <Fragment key={i}>
                <div className={`head${x.person ? "" : " warn"}`}>
                  {x.person ? (
                    <>
                      {x.person.name}{" "}
                      <span className="off">
                        {zoneOffsetMin(x.person.zone, now) - viewerOff === 0
                          ? "=you"
                          : fmtOffset(zoneOffsetMin(x.person.zone, now) - viewerOff).slice(3)}
                      </span>{" "}
                      {fmtMin(x.person.start)}–{fmtMin(x.person.end)}
                    </>
                  ) : (
                    <>fix me ↑</>
                  )}
                </div>
                {slots.map((at, j) => {
                  const on = rowMasks[i]?.[j];
                  return (
                    <div
                      className={`cell${on ? " on" : ""}`}
                      key={j}
                      title={
                        x.person
                          ? `${x.person.name} ${fmtMin(wallMinutes(x.person.zone, at))} (${x.person.zone})`
                          : undefined
                      }
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          {showNow && (
            <div className="now" aria-hidden="true" style={{ left: `calc(190px + (100% - 190px) * ${frac})` }} />
          )}
        </div>
      </div>

      <footer>
        Anchored to <em>today</em> in your timezone — every cell asks Intl per-instant, so DST shifts are the
        platform's problem (a date picker arrives when someone plans across a transition date). Overnight shifts
        (end ≤ start) aren't supported — that's a different complaint. No accounts, no calendar: the URL hash
        carries the whole team.
        {/* ponytail: no date picker — the grid answers "which band TODAY", the complaint's actual question; add one when a planner needs to compare a DST-transition date */}
      </footer>
    </>
  );
}
