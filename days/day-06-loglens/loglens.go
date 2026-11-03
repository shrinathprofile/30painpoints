// loglens — read a log file, print the records grep can't see.
//
// Auto-detects the format (JSON / apache CLF / plain), parses each line into a
// record with time + level + message, attaches following non-timestamp lines
// (stack traces) to the record above them, filters by level and time window,
// and collapses consecutive duplicate records to xN.
//
// Exit codes follow grep so existing pipelines swap over unchanged:
// 0 matched, 1 nothing matched, 2 cannot check (missing file, no level info
// for -level, no timestamps for -since, usage error).
//
// ponytail: single-file CLI, stdlib only — encoding/json, time, flag, bufio.
// No streaming pass: records buffer in memory because -since anchors to the
// file's NEWEST timestamp ("last 30 minutes of this log" — grep -A can't).
// Upgrade trigger: logs too big for RAM, then two-pass (index first, print second).

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---------- records ----------

type Record struct {
	Line    int // 1-based line number of the record's first line
	Time    time.Time
	HasTime bool
	Level   string // normalized (TRACE..FATAL) or "" when the line carries none
	Msg     string
	Extra   []string // continuation lines: stack traces, cause chains
}

// ---------- level normalization ----------

var levelNames = map[string]string{
	"trace": "TRACE", "debug": "DEBUG", "info": "INFO", "information": "INFO", "notice": "NOTICE",
	"warn": "WARN", "warning": "WARN", "error": "ERROR", "err": "ERROR", "severe": "ERROR",
	"fatal": "FATAL", "crit": "FATAL", "critical": "FATAL", "alert": "FATAL", "emerg": "FATAL", "panic": "FATAL",
}

func normLevel(s string) string { return levelNames[strings.ToLower(strings.TrimSpace(s))] }

// levelFromNumber: 0-7 syslog, 10-50 python logging's ladder. Anything else is not a level.
func levelFromNumber(n float64) string {
	syslog := []string{"FATAL", "FATAL", "FATAL", "ERROR", "WARN", "NOTICE", "INFO", "DEBUG"}
	python := map[int]string{10: "DEBUG", 20: "INFO", 30: "WARN", 40: "ERROR", 50: "FATAL"}
	i := int(n)
	switch {
	case n >= 0 && n < 8 && n == float64(i):
		return syslog[i]
	case n >= 10 && n <= 50 && n == float64(i):
		return python[i]
	}
	return ""
}

// ---------- time parsing ----------

// ponytail: syslog ("Jan  2 15:04:05") keeps year 0 — year-less timestamps
// can't guess a year honestly; absolute-window users should not mix them in.
var timeLayouts = []string{
	time.RFC3339Nano, time.RFC3339,
	"2006-01-02T15:04:05", "2006-01-02 15:04:05.000000", "2006-01-02 15:04:05.000",
	"2006-01-02 15:04:05,000", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05",
	"02/Jan/2006:15:04:05 -0700", // apache, inside [brackets]
	"Jan _2 15:04:05",            // syslog, year-less
}

func parseTimeStamp(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, l := range timeLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// epoch heuristics: ns > 1e17 > µs > 1e14 > ms > 1e11 > s (2026 ≈ 1.79e9 s).
// Takes a STRING: float64 cannot hold a ns-precision epoch (19 significant
// digits vs float64's ~16) — the digits past the decimal noise are wrong.
func parseEpoch(s string) (time.Time, bool) {
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		switch {
		case n > 1e17:
			return time.Unix(0, n).UTC(), true
		case n > 1e14:
			return time.Unix(0, n*1e3).UTC(), true
		case n > 1e11:
			return time.Unix(0, n*1e6).UTC(), true
		default:
			return time.Unix(n, 0).UTC(), true
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return time.Time{}, false
	}
	return time.Unix(int64(f), 0).UTC(), true // float seconds: sub-second digits are a courtesy
}

// ---------- format detection ----------

type format int

const (
	fmtJSON format = iota
	fmtApache
	fmtPlain
)

func (f format) String() string {
	switch f {
	case fmtJSON:
		return "json"
	case fmtApache:
		return "apache"
	default:
		return "plain"
	}
}

// sniffFormat: first 50 non-empty lines vote — but only lines that anchor in
// SOME format get a vote. A JSON log whose errors carry stack traces is half
// non-JSON lines; counting those against JSON rejected the tool's own core
// case. Continuation lines (stacks, junk) are continuations in every format.
func sniffFormat(lines []string) format {
	var j, a int
	seen := 0
	for _, s := range lines {
		if seen >= 50 {
			break
		}
		if s = strings.TrimSpace(s); s == "" {
			continue
		}
		seen++
		if _, ok := parseJSONLine(s); ok {
			j++
		} else if _, ok := parseApacheLine(s); ok {
			a++
		}
	}
	switch {
	case j > 1 && j >= a: // >1: one stray JSON blob must not capture a plain file
		return fmtJSON
	case a > 1 && a > j:
		return fmtApache
	default:
		return fmtPlain
	}
}

// ---------- line parsers ----------

var jsonTimeKeys = []string{"time", "ts", "timestamp", "@timestamp", "datetime"}
var jsonLevelKeys = []string{"level", "severity", "lvl"}
var jsonMsgKeys = []string{"message", "msg"}

func parseJSONLine(s string) (Record, bool) {
	if !strings.HasPrefix(strings.TrimSpace(s), "{") {
		return Record{}, false
	}
	// UseNumber: numbers stay json.Number — exact int64 for ns-precision
	// epochs; float64 would silently round 1793750400123456789 to ...568
	dec := json.NewDecoder(strings.NewReader(s))
	dec.UseNumber()
	var obj map[string]any
	if err := dec.Decode(&obj); err != nil {
		return Record{}, false
	}
	rec := Record{Msg: strings.TrimSpace(s)} // fallback: the raw line IS the message
	num := func(v any) (float64, bool) {
		n, ok := v.(json.Number)
		if !ok {
			return 0, false
		}
		f, err := n.Float64()
		return f, err == nil
	}
	for _, k := range jsonTimeKeys {
		switch x := obj[k].(type) {
		case string:
			if t, ok := parseTimeStamp(x); ok {
				rec.Time, rec.HasTime = t, true
			}
		case json.Number:
			if t, ok := parseEpoch(x.String()); ok {
				rec.Time, rec.HasTime = t, true
			}
		}
		if rec.HasTime {
			break
		}
	}
	for _, k := range jsonLevelKeys {
		if f, ok := num(obj[k]); ok {
			rec.Level = levelFromNumber(f)
		} else if x, isStr := obj[k].(string); isStr {
			rec.Level = normLevel(x)
		}
		if rec.Level != "" {
			break
		}
	}
	for _, k := range jsonMsgKeys {
		if v, ok := obj[k].(string); ok && strings.TrimSpace(v) != "" {
			rec.Msg = v
			break
		}
	}
	return rec, true
}

// 127.0.0.1 - frank [10/Oct/2026:13:55:36 -0700] "GET /api HTTP/1.1" 500 123
var apacheRe = regexp.MustCompile(`^\S+ \S+ \S+ \[([^\]]+)\] "([^"]*)" (\d{3}) (?:\d+|-)`)

func parseApacheLine(s string) (Record, bool) {
	m := apacheRe.FindStringSubmatch(s)
	if m == nil {
		return Record{}, false
	}
	rec := Record{Msg: m[2]}
	if t, ok := parseTimeStamp(m[1]); ok {
		rec.Time, rec.HasTime = t, true
	}
	switch c := m[3][0]; {
	case c >= '5':
		rec.Level = "ERROR"
	case c >= '4':
		rec.Level = "WARN"
	default:
		rec.Level = "INFO"
	}
	return rec, true
}

// plain: an anchor is a leading timestamp OR a level word. Lines with neither
// are continuations (stack-trace lines are exactly this shape).
var (
	// [ date ] brackets: log4j/logback wrap the timestamp; python logging uses a
	// comma for milliseconds; both must anchor a record, not become continuations
	plainTimeRe = regexp.MustCompile(`^\[?((?:\d{4}-\d{2}-\d{2}[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?)|(?:[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}))\]?`)
	plainKvTime = regexp.MustCompile(`^(?:time|ts|timestamp)=`)
	plainLevel  = regexp.MustCompile(`^\s*\[?(TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRIT|CRITICAL|PANIC)\]?[:\s]`)
	plainKv     = regexp.MustCompile(`\b(?:level|lvl)=([A-Za-z]+)`)
	plainMsg    = regexp.MustCompile(`\bmsg="([^"]*)"`)
)

func parsePlainLine(s string) (Record, bool) {
	rec := Record{}
	// logfmt puts the timestamp behind a key: time=2026-… — strip the key so
	// the anchored timestamp regex can see the value.
	// ponytail: npm's "0 verbose cli …" counter-prefixed levels are NOT
	// recognized — that file reads as plain-inert (shown, never guessed);
	// npm's log format gets a parser the day someone asks for it.
	body := s
	if m := plainKvTime.FindStringIndex(s); m != nil {
		body = s[m[1]:]
	}
	rest := body
	// the timestamp prefix is only consumed when it actually parses — a
	// lookalike prefix ("The  2 15:04:05") must not eat the line's level word
	if m := plainTimeRe.FindStringSubmatchIndex(body); m != nil {
		if t, ok := parseTimeStamp(body[m[2]:m[3]]); ok {
			rec.Time, rec.HasTime = t, true
			rest = body[m[1]:]
		}
	}
	if m := plainLevel.FindStringSubmatchIndex(rest); m != nil {
		rec.Level = normLevel(rest[m[2]:m[3]])
		rest = rest[m[1]:] // the message starts after the level token, not inside it
	} else if m := plainKv.FindStringSubmatch(rest); m != nil {
		rec.Level = normLevel(m[1])
	}
	// logfmt msg="..." is the message when this line is logfmt-shaped
	if rec.Level != "" {
		if m := plainMsg.FindStringSubmatch(rest); m != nil {
			rec.Msg = m[1]
			return rec, true
		}
	}
	rec.Msg = strings.TrimSpace(rest)
	return rec, rec.HasTime || rec.Level != ""
}

// parseLine: dispatch on the detected format; anchored=false means "this line
// belongs to the record above it (or is junk before the first record)".
func parseLine(f format, s string) (Record, bool) {
	switch f {
	case fmtJSON:
		return parseJSONLine(s)
	case fmtApache:
		return parseApacheLine(s)
	default:
		return parsePlainLine(s)
	}
}

// ---------- file → records ----------

type stats struct {
	junk      int  // unanchored lines before the first record
	skipped   int  // records outside the level/time filter
	noLevel   int  // dropped: -level was asked but the record has no level
	timeless  int  // dropped: a window was asked but the record has no time
	inertFile bool // no line anywhere carried a time or a level
}

func parseLines(f format, lines []string) ([]Record, stats) {
	var recs []Record
	var st stats
	for i, raw := range lines {
		s := strings.TrimSuffix(raw, "\r")
		if i == 0 {
			s = strings.TrimPrefix(s, "\ufeff") // day-04 lesson: PowerShell exports carry a UTF-8 BOM
		}
		if strings.TrimSpace(s) == "" {
			continue
		}
		rec, anchored := parseLine(f, s)
		if !anchored {
			if len(recs) > 0 {
				recs[len(recs)-1].Extra = append(recs[len(recs)-1].Extra, s)
			} else {
				st.junk++
			}
			continue
		}
		rec.Line = i + 1
		recs = append(recs, rec)
	}
	if len(recs) == 0 && st.junk > 0 {
		// inert plain file: no line anywhere carried a time or a level — every
		// line is its own record, and any -level/-since becomes a cannot-check
		st.inertFile = true
		st.junk = 0
		for i, s := range lines {
			if strings.TrimSpace(s) == "" {
				continue
			}
			recs = append(recs, Record{Line: i + 1, Msg: strings.TrimSpace(s)})
		}
	}
	return recs, st
}

// ---------- filtering ----------

// resolveBound: a Go duration ("30m") is anchored to the log's newest
// timestamp ("last 30 minutes OF THE LOG" — right for archived files);
// an RFC3339 stamp is absolute. nil bound = unset.
func resolveBound(v string, anchor time.Time) (*time.Time, error) {
	if v == "" {
		return nil, nil
	}
	if d, err := time.ParseDuration(v); err == nil {
		t := anchor.Add(-d)
		return &t, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t, nil
	}
	return nil, fmt.Errorf("not a duration (30m, 2h) or RFC3339 timestamp: %q", v)
}

type filter struct {
	levels map[string]bool
	lo, hi *time.Time
}

func filterRecords(recs []Record, flt filter, st *stats) []Record {
	var out []Record
	for _, r := range recs {
		if flt.lo != nil || flt.hi != nil {
			if !r.HasTime {
				st.timeless++
				continue
			}
			if flt.lo != nil && r.Time.Before(*flt.lo) ||
				flt.hi != nil && r.Time.After(*flt.hi) {
				st.skipped++
				continue
			}
		}
		if len(flt.levels) > 0 && !flt.levels[r.Level] {
			if r.Level == "" {
				st.noLevel++
			} else {
				st.skipped++
			}
			continue
		}
		out = append(out, r)
	}
	return out
}

// ---------- collapsing ----------

type group struct {
	rec   Record
	n     int
	first time.Time
	last  time.Time
}

// collapse consecutive duplicates: same fingerprint (level + message + extra).
// Repeats at different times keep their place — context is information.
func collapse(recs []Record) []group {
	var out []group
	for _, r := range recs {
		if len(out) > 0 {
			g := &out[len(out)-1]
			// ponytail: fingerprint is exact text, no normalization of numbers/
			// ids inside messages - the same crash with a different request id
			// is a different crash until a user asks for fuzzy grouping
			if g.rec.Level == r.Level && g.rec.Msg == r.Msg && strings.Join(g.rec.Extra, "\x00") == strings.Join(r.Extra, "\x00") {
				g.n++
				g.last = r.Time
				continue
			}
		}
		out = append(out, group{rec: r, n: 1, first: r.Time, last: r.Time})
	}
	return out
}

// ---------- rendering ----------

var useColor = false

func paint(code, s string) string {
	if !useColor {
		return s
	}
	return "\x1b[" + code + "m" + s + "\x1b[0m"
}

func levelColor(l string) string {
	switch l {
	case "FATAL":
		return "1;31"
	case "ERROR":
		return "31"
	case "WARN":
		return "33"
	case "DEBUG", "TRACE":
		return "36"
	case "":
		return "2"
	default:
		return "32"
	}
}

// stackCap: at most 10 continuation lines shown — the complaint is drowning,
// not missing data.
// ponytail: capped stack dumps; a user who needs the full 200-line trace asks.
const stackCap = 10

func writeRecord(w io.Writer, g group) {
	lvl := g.rec.Level
	if lvl == "" {
		lvl = "—"
	}
	ts := "—"
	if g.rec.HasTime {
		ts = g.rec.Time.Format(time.RFC3339)
	}
	_ = ts // timestamp lives in the footer and dup-range; line number is the address grep users know
	dup := ""
	if g.n > 1 {
		dup = paint("1", fmt.Sprintf(" ×%d", g.n))
		if g.first != g.last {
			dup += paint("2", fmt.Sprintf(" (… %s)", g.last.Format("15:04:05")))
		}
	}
	fmt.Fprintf(w, "%s %s %s%s\n",
		paint(levelColor(g.rec.Level), fmt.Sprintf("%-5s", lvl)),
		paint("2", fmt.Sprintf("%6d", g.rec.Line)),
		trunc(g.rec.Msg, 160),
		dup)
	for i, x := range g.rec.Extra {
		if i >= stackCap {
			fmt.Fprintf(w, "%s\n", paint("2", fmt.Sprintf("       … +%d more continuation line(s)", len(g.rec.Extra)-stackCap)))
			break
		}
		fmt.Fprintf(w, "       %s\n", trunc(x, 200))
	}
}

func trunc(s string, n int) string {
	s = strings.ReplaceAll(s, "\t", " ")
	if len(s) > n {
		return s[:n-1] + "…"
	}
	return s
}

// ---------- main ----------

// grep users write flags after the file; Go's flag package stops parsing at
// the first positional. Hoist known flags so "loglens app.log -level error"
// parses the way the person typing it meant it.
// ponytail: the arity map lists flags by hand — a flag added to the FlagSet
// but not here stays Go-convention (flags first). Upgrade trigger: a second
// flag day, then derive the map from the FlagSet itself.
func reorderArgs(args []string) []string {
	takesValue := map[string]bool{"level": true, "since": true, "until": true}
	zeroAry := map[string]bool{"h": true, "help": true}
	var flags, pos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		name := strings.TrimLeft(a, "-")
		if strings.HasPrefix(a, "-") && a != "-" && (takesValue[name] || zeroAry[name]) {
			flags = append(flags, a)
			if takesValue[name] && !strings.Contains(a, "=") && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
			continue
		}
		pos = append(pos, a)
	}
	return append(flags, pos...)
}

func run(args []string, stdout, stderr io.Writer) int {
	// ContinueOnError, not ExitOnError: usage errors return as exit 2 (the
	// trichotomy), and -h returns 0 — without os.Exit killing test processes
	fs := flag.NewFlagSet("loglens", flag.ContinueOnError)
	fs.SetOutput(stderr)
	levelList := fs.String("level", "", "levels to show, comma-separated (trace,debug,info,notice,warn,error,fatal)")
	since := fs.String("since", "", "window start: duration back from the log's newest entry (30m) or RFC3339")
	until := fs.String("until", "", "window end: duration back from newest (5m) or RFC3339")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "usage: loglens [file] [-level error,warn] [-since 30m] [-until 5m]")
		fmt.Fprintln(stderr, "  file '-' or omitted (when stdin is a pipe): read stdin")
		fmt.Fprintln(stderr, "  exits: 0 matched · 1 nothing matched · 2 cannot check")
		fs.PrintDefaults()
	}
	if err := fs.Parse(reorderArgs(args)); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() > 1 {
		fmt.Fprintln(stderr, "loglens: one file at a time")
		return 2
	}

	path := "-"
	if fs.NArg() == 1 {
		path = fs.Arg(0)
	}
	var in io.Reader
	switch {
	case path == "-":
		if fi, err := os.Stdin.Stat(); err != nil || fi.Mode()&os.ModeCharDevice != 0 {
			fmt.Fprintln(stderr, "loglens: no file given and stdin is a terminal — pass a file or pipe into me")
			return 2
		}
		in = os.Stdin
	default:
		f, err := os.Open(path)
		if err != nil {
			fmt.Fprintf(stderr, "loglens: cannot read %s: %v\n", path, err)
			return 2
		}
		defer f.Close()
		in = f
	}

	lines, err := readLines(in)
	if err != nil {
		fmt.Fprintf(stderr, "loglens: read error: %v\n", err)
		return 2
	}
	f := sniffFormat(lines)
	recs, st := parseLines(f, lines)

	// validate the filters against what the file can actually support BEFORE
	// dropping anything: a missing dimension is a cannot-check (2), never a
	// silent "nothing matched" (1) — day-04/05 trichotomy, carried
	flt := filter{levels: map[string]bool{}}
	if *levelList != "" {
		for _, l := range strings.Split(*levelList, ",") {
			nl := normLevel(l)
			if nl == "" {
				fmt.Fprintf(stderr, "loglens: unknown level %q (trace,debug,info,notice,warn,error,fatal)\n", strings.TrimSpace(l))
				return 2
			}
			flt.levels[nl] = true
		}
		if !anyHasLevel(recs) {
			fmt.Fprintf(stderr, "loglens: -level given but no line in %s carries level information (%s format)\n", path, f)
			return 2
		}
	}
	anchor, hasAnyTime := newestTime(recs)
	if (*since != "" || *until != "") && !hasAnyTime {
		fmt.Fprintf(stderr, "loglens: time window given but no line in %s carries a timestamp (%s format)\n", path, f)
		return 2
	}
	lo, err := resolveBound(*since, anchor)
	if err != nil {
		fmt.Fprintf(stderr, "loglens: -since %v\n", err)
		return 2
	}
	hi, err := resolveBound(*until, anchor)
	if err != nil {
		fmt.Fprintf(stderr, "loglens: -until %v\n", err)
		return 2
	}
	flt.lo, flt.hi = lo, hi

	shown := filterRecords(recs, flt, &st)
	groups := collapse(shown)

	if fi, err := os.Stdout.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 && os.Getenv("NO_COLOR") == "" {
		useColor = true
	}
	for _, g := range groups {
		writeRecord(stdout, g)
	}

	dupCount, dupGroups := 0, 0
	for _, g := range groups {
		if g.n > 1 {
			dupCount += g.n - 1
			dupGroups++
		}
	}
	window := ""
	switch {
	case lo != nil && hi != nil:
		window = fmt.Sprintf(" · window %s → %s", lo.Format(time.RFC3339), hi.Format(time.RFC3339))
	case lo != nil:
		window = " · window " + lo.Format(time.RFC3339) + " →"
	case hi != nil:
		window = " · window → " + hi.Format(time.RFC3339)
	}
	fmt.Fprintf(stderr, "loglens — %s (%s format) · %d record(s) · %d shown · %d duplicate(s) collapsed (%d group(s)) · %d filtered · %d timeless · %d level-less%s%s\n",
		path, f, len(recs), len(groups), dupCount, dupGroups, st.skipped, st.timeless, st.noLevel, window, suffixJunk(st))

	if len(groups) == 0 {
		return 1
	}
	return 0
}

func suffixJunk(st stats) string {
	switch {
	case st.inertFile:
		return " · no time or level found anywhere (plain-inert)"
	case st.junk > 0:
		return fmt.Sprintf(" · %d junk line(s) before the first record", st.junk)
	default:
		return ""
	}
}

func readLines(in io.Reader) ([]string, error) {
	var lines []string
	r := bufio.NewReader(in)
	for {
		s, err := r.ReadString('\n')
		if s != "" {
			lines = append(lines, strings.TrimSuffix(s, "\n"))
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return lines, nil
			}
			return nil, err
		}
	}
}

func anyHasLevel(recs []Record) bool {
	for _, r := range recs {
		if r.Level != "" {
			return true
		}
	}
	return false
}

func newestTime(recs []Record) (time.Time, bool) {
	var max time.Time
	found := false
	for _, r := range recs {
		if r.HasTime && (!found || r.Time.After(max)) {
			max, found = r.Time, true
		}
	}
	return max, found
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
