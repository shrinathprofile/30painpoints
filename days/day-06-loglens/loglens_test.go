// self-check — the one runnable check. Assert-based, stdlib testing only,
// no framework. Run: go test    (or: go test -v)
//
// Two layers, days 02-05 lesson: pure tables for the parsers, and run() /
// subprocess runs for the CLI wiring — fakes and pure functions pass while
// the wiring rots; the real run is the test suite's final member.

package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------- level normalization ----------

func TestNormLevelAliases(t *testing.T) {
	cases := map[string]string{
		"WARNING": "WARN", "warning": "WARN", "err": "ERROR", "severe": "ERROR",
		"panic": "FATAL", "CRIT": "FATAL", "critical": "FATAL", "emerg": "FATAL",
		"information": "INFO", " notice ": "NOTICE", "bogus": "", "": "",
	}
	for in, want := range cases {
		if got := normLevel(in); got != want {
			t.Errorf("normLevel(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLevelFromNumber(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "FATAL"}, {3, "ERROR"}, {4, "WARN"}, {7, "DEBUG"}, // syslog severities
		{10, "DEBUG"}, {20, "INFO"}, {30, "WARN"}, {40, "ERROR"}, {50, "FATAL"}, // python logging
		{8, ""}, {9, ""}, {25, ""}, {3.5, ""}, // not a level in either ladder
	}
	for _, c := range cases {
		if got := levelFromNumber(c.in); got != c.want {
			t.Errorf("levelFromNumber(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ---------- time parsing ----------

func TestParseTimeStampLayouts(t *testing.T) {
	cases := map[string]time.Time{
		"2026-11-04T10:04:11Z":        time.Date(2026, 11, 4, 10, 4, 11, 0, time.UTC),
		"2026-11-04T10:04:11.123456Z": time.Date(2026, 11, 4, 10, 4, 11, 123456000, time.UTC),
		"2026-11-04 10:04:11":         time.Date(2026, 11, 4, 10, 4, 11, 0, time.UTC),
		"2026-11-04 10:04:11,123":     time.Date(2026, 11, 4, 10, 4, 11, 123000000, time.UTC),
		"2026-11-04 10:04:20Z":        time.Date(2026, 11, 4, 10, 4, 20, 0, time.UTC),
		"04/Nov/2026:10:01:11 -0700":  time.Date(2026, 11, 4, 10, 1, 11, 0, time.FixedZone("", -7*3600)),
	}
	for in, wantT := range cases {
		got, ok := parseTimeStamp(in)
		if !ok || !got.Equal(wantT) {
			t.Errorf("parseTimeStamp(%q) = %v,%v want %v", in, got, ok, wantT)
		}
	}
	if _, ok := parseTimeStamp(""); ok {
		t.Error("empty string is not a timestamp")
	}
	if _, ok := parseTimeStamp("The  2 15:04:05"); ok {
		t.Error("lookalike prefix must not parse as a timestamp")
	}
}

func TestParseEpochHeuristics(t *testing.T) {
	sec, ok := parseEpoch("1793750400")
	if !ok || !sec.Equal(time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("epoch seconds: got %v %v", sec, ok)
	}
	ms, _ := parseEpoch("1793750400123") // 1.79e12: milliseconds
	if !ms.Equal(time.Date(2026, 11, 4, 0, 0, 0, 123000000, time.UTC)) {
		t.Errorf("epoch millis: got %v", ms)
	}
	// ns precision: float64 would round ...456789 to ...456768 (16 sig digits)
	ns, _ := parseEpoch("1793750400123456789")
	if !ns.Equal(time.Date(2026, 11, 4, 0, 0, 0, 123456789, time.UTC)) {
		t.Errorf("epoch nanos: got %v", ns)
	}
}

// ---------- line parsers ----------

func TestParseJSONLine(t *testing.T) {
	rec, ok := parseJSONLine(`{"time":"2026-11-04T10:04:11Z","level":"error","msg":"db query failed"}`)
	if !ok || rec.Level != "ERROR" || rec.Msg != "db query failed" || !rec.HasTime ||
		!rec.Time.Equal(time.Date(2026, 11, 4, 10, 4, 11, 0, time.UTC)) {
		t.Errorf("basic JSON record: %+v ok=%v", rec, ok)
	}
	// epoch-ms ts + python numeric lvl + "message" key
	rec, _ = parseJSONLine(`{"ts":1793750400123,"lvl":40,"message":"payments worker crashed"}`)
	if rec.Level != "ERROR" || rec.Msg != "payments worker crashed" ||
		!rec.Time.Equal(time.Date(2026, 11, 4, 0, 0, 0, 123000000, time.UTC)) {
		t.Errorf("epoch/py-level JSON record: %+v", rec)
	}
	// syslog numeric severity, severity key with alias
	rec, _ = parseJSONLine(`{"time":"2026-11-04T10:16:00Z","level":3,"msg":"upstream 502"}`)
	if rec.Level != "ERROR" {
		t.Errorf("syslog sev 3 should be ERROR: %+v", rec)
	}
	rec, _ = parseJSONLine(`{"time":"2026-11-04T10:14:02Z","severity":"warning","message":"disk usage 91%"}`)
	if rec.Level != "WARN" || rec.Msg != "disk usage 91%" {
		t.Errorf("severity alias: %+v", rec)
	}
	// no msg field: the raw line is the message
	rec, _ = parseJSONLine(`{"level":"warn","x":1}`)
	if rec.Msg != `{"level":"warn","x":1}` || rec.Level != "WARN" || rec.HasTime {
		t.Errorf("fallback msg: %+v", rec)
	}
	for _, bad := range []string{`not json`, `{"level":`, `[1,2]`, `42`, ``} {
		if _, ok := parseJSONLine(bad); ok {
			t.Errorf("%q must not parse as a JSON record", bad)
		}
	}
}

func TestParseApacheLine(t *testing.T) {
	line := `leela - - [04/Nov/2026:10:01:11 -0700] "GET /shutdown HTTP/1.0" 500 0`
	rec, ok := parseApacheLine(line)
	if !ok || rec.Level != "ERROR" || rec.Msg != "GET /shutdown HTTP/1.0" || !rec.HasTime ||
		!rec.Time.Equal(time.Date(2026, 11, 4, 10, 1, 11, 0, time.FixedZone("", -7*3600))) {
		t.Errorf("apache 500: %+v ok=%v", rec, ok)
	}
	if rec, _ := parseApacheLine(`h - - [04/Nov/2026:10:00:04 -0700] "GET /x HTTP/1.0" 404 231`); rec.Level != "WARN" {
		t.Errorf("404 should be WARN, got %q", rec.Level)
	}
	if rec, _ := parseApacheLine(`h - - [04/Nov/2026:10:02:30 -0700] "GET /stats.json HTTP/1.0" 200 -`); rec.Level != "INFO" {
		t.Errorf("200 with '-' bytes should be INFO, got %q", rec.Level)
	}
	if _, ok := parseApacheLine(`this is not clf at all`); ok {
		t.Error("non-CLF line must not anchor")
	}
}

func TestParsePlainLine(t *testing.T) {
	// python logging: comma millis, level word after space, message without the level token
	rec, ok := parsePlainLine("2026-11-04 10:00:02,001 ERROR payment failed")
	if !ok || rec.Level != "ERROR" || rec.Msg != "payment failed" || !rec.HasTime {
		t.Errorf("python-style: %+v ok=%v", rec, ok)
	}
	// logfmt: time= behind a key, level= mid-line, msg= quoted
	rec, ok = parsePlainLine(`time=2026-11-04T10:03:00Z level=warn msg="retry queue depth 41" attempt=2`)
	if !ok || rec.Level != "WARN" || rec.Msg != "retry queue depth 41" || !rec.HasTime {
		t.Errorf("logfmt: %+v ok=%v", rec, ok)
	}
	// log4j: bracketed timestamp
	rec, ok = parsePlainLine("[2026-11-04 10:04:00Z] NOTICE log rotation scheduled")
	if !ok || rec.Level != "NOTICE" || rec.Msg != "log rotation scheduled" {
		t.Errorf("log4j bracketed: %+v ok=%v", rec, ok)
	}
	// syslog, year-less: anchored, year 0 — the documented ponytail ceiling
	rec, ok = parsePlainLine("Nov  4 09:59:58 web1 sshd[4242]: Accepted publickey for deploy")
	if !ok || !rec.HasTime || rec.Time.Year() != 0 || rec.Level != "" ||
		rec.Msg != "web1 sshd[4242]: Accepted publickey for deploy" {
		t.Errorf("syslog: %+v ok=%v", rec, ok)
	}
	// prose safety: error_rate mid-line is not a level; the timestamp anchors it
	rec, ok = parsePlainLine("2026-11-04 10:04:20Z metrics mention error_rate=0.3 in prose")
	if !ok || rec.Level != "" || rec.Msg != "metrics mention error_rate=0.3 in prose" {
		t.Errorf("prose: %+v ok=%v", rec, ok)
	}
	// lookalike timestamp prefix ("The" is not a month) never consumes the
	// line, and a mid-line level word never anchors — prose safety is the
	// point, so this line is a continuation by design
	if rec, ok := parsePlainLine("The  2 15:04:05 ERROR bogus"); ok || rec.Level != "" {
		t.Errorf("lookalike: must stay a continuation, got %+v ok=%v", rec, ok)
	}
	// no anchor at all: a continuation, not a record
	if _, ok := parsePlainLine("    at main.go:42 +0xf8"); ok {
		t.Error("stack-trace-shaped line must not anchor")
	}
}

// ---------- file → records ----------

func TestParseLinesAttachmentAndJunk(t *testing.T) {
	lines := []string{
		"boot banner before any record", // junk: nothing above it to attach to
		`{"time":"2026-11-04T10:04:11Z","level":"error","msg":"db query failed"}`,
		"goroutine 1 [running]:",
		"main.queryDB()",
		`{"time":"2026-11-04T10:05:00Z","level":"info","msg":"ok"}`,
	}
	recs, st := parseLines(fmtJSON, lines)
	if len(recs) != 2 {
		t.Fatalf("want 2 records, got %d", len(recs))
	}
	if st.junk != 1 {
		t.Errorf("junk before first record = %d, want 1", st.junk)
	}
	if len(recs[0].Extra) != 2 || recs[0].Extra[0] != "goroutine 1 [running]:" {
		t.Errorf("stack must attach to the record above: %+v", recs[0].Extra)
	}
	if recs[0].Line != 2 || recs[1].Line != 5 {
		t.Errorf("line numbers are the record's first line: %d %d", recs[0].Line, recs[1].Line)
	}
}

func TestParseLinesCRLFAndBOM(t *testing.T) {
	lines := []string{
		"\ufeff2026-11-04 10:00:01Z INFO boot",
		"2026-11-04 10:00:02Z INFO ready",
	}
	recs, _ := parseLines(fmtPlain, lines)
	if len(recs) != 2 || recs[0].Level != "INFO" {
		t.Fatalf("BOM + CRLF must not break anchoring: %+v", recs)
	}
	crlf := []string{"2026-11-04 10:00:01Z INFO boot\r"}
	recs, _ = parseLines(fmtPlain, crlf)
	if len(recs) != 1 || recs[0].Msg != "boot" {
		t.Errorf("trailing CR must be stripped: %+v", recs)
	}
}

func TestParseLinesInertPlainFile(t *testing.T) {
	recs, st := parseLines(fmtPlain, []string{"just some text", "no structure here"})
	if len(recs) != 2 || !st.inertFile || recs[0].Msg != "just some text" {
		t.Fatalf("inert file: every line its own record, flagged: %+v %+v", recs, st)
	}
	if recs[0].Level != "" || recs[0].HasTime {
		t.Error("inert records carry no time and no level — displayed, not guessed")
	}
}

func TestSniffFormatCandidatesNotLines(t *testing.T) {
	// THE core case: a JSON log whose errors carry stack traces is half
	// non-JSON lines — the vote is among anchor candidates, not all lines
	app, err := os.ReadFile("fixtures/app.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if f := sniffFormat(splitLines(string(app))); f != fmtJSON {
		t.Errorf("app.log: want json, got %v", f)
	}
	acc, _ := os.ReadFile("fixtures/access.clf")
	if f := sniffFormat(splitLines(string(acc))); f != fmtApache {
		t.Errorf("access.log: want apache, got %v", f)
	}
	plain, _ := os.ReadFile("fixtures/plain.txt")
	if f := sniffFormat(splitLines(string(plain))); f != fmtPlain {
		t.Errorf("plain.log: want plain, got %v", f)
	}
	// one stray JSON blob must not capture a plain file (the j>1 guard)
	if f := sniffFormat([]string{"plain line", `{"a":1}`, "another plain line"}); f != fmtPlain {
		t.Errorf("stray JSON blob must not capture a plain file, got %v", f)
	}
}

func splitLines(s string) []string {
	return strings.Split(strings.TrimSuffix(s, "\n"), "\n")
}

// ---------- filtering / collapsing ----------

func TestResolveBound(t *testing.T) {
	anchor := time.Date(2026, 11, 4, 10, 30, 0, 0, time.UTC)
	if b, err := resolveBound("", anchor); b != nil || err != nil {
		t.Error("unset bound must be nil,nil")
	}
	b, err := resolveBound("30m", anchor)
	if err != nil || !b.Equal(anchor.Add(-30*time.Minute)) {
		t.Errorf("duration bound: %v %v", b, err)
	}
	b, _ = resolveBound("2026-11-04T10:00:00Z", anchor)
	if !b.Equal(time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("absolute bound: %v", b)
	}
	if _, err := resolveBound("notatime", anchor); err == nil {
		t.Error("garbage bound must error, not anchor somewhere")
	}
}

func mkRec(level, msg string, at string, extra ...string) Record {
	r := Record{Level: level, Msg: msg, Extra: extra}
	if at != "" {
		r.Time, _ = parseTimeStamp(at)
		r.HasTime = true
	}
	return r
}

func TestFilterCountsEveryDrop(t *testing.T) {
	st := stats{}
	lo := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	flt := filter{lo: &lo, levels: map[string]bool{"ERROR": true}}
	recs := []Record{
		mkRec("ERROR", "in", "2026-11-04T10:05:00Z"),            // shown
		mkRec("ERROR", "out-of-window", "2026-11-04T09:00:00Z"), // skipped
		mkRec("INFO", "wrong-level", "2026-11-04T10:05:00Z"),    // skipped
		mkRec("ERROR", "timeless", ""),                          // timeless
		mkRec("", "level-less", "2026-11-04T10:05:00Z"),         // noLevel
	}
	out := filterRecords(recs, flt, &st)
	if len(out) != 1 || out[0].Msg != "in" {
		t.Fatalf("filter: %+v", out)
	}
	if st.skipped != 2 || st.timeless != 1 || st.noLevel != 1 {
		t.Errorf("every drop counted: %+v", st)
	}
}

func TestCollapse(t *testing.T) {
	er := func(extra ...string) Record {
		return mkRec("ERROR", "db query failed", "2026-11-04T10:04:11Z", extra...)
	}
	groups := collapse([]Record{er(), er(), er(), mkRec("INFO", "ok", "2026-11-04T10:05:00Z"), er()})
	if len(groups) != 3 {
		t.Fatalf("3 groups (×3, single, repeat), got %d", len(groups))
	}
	if groups[0].n != 3 || groups[2].n != 1 {
		t.Errorf("consecutive dups collapse; non-consecutive stay separate: %d %d", groups[0].n, groups[2].n)
	}
	// the Join-separator regression: ["a b"] and ["a","b"] must NOT collide
	if g := collapse([]Record{mkRec("E", "m", "", "a b"), mkRec("E", "m", "", "a", "b")}); len(g) != 2 {
		t.Errorf("space-join collision: %d groups, want 2", len(g))
	}
	// different level with same message = different record
	if g := collapse([]Record{mkRec("ERROR", "m", ""), mkRec("WARN", "m", "")}); len(g) != 2 {
		t.Errorf("level is part of the fingerprint: %d groups", len(g))
	}
}

// ---------- run(): in-process CLI wiring ----------

func runCLI(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var out, errb bytes.Buffer
	code := run(args, &out, &errb)
	return code, out.String(), errb.String()
}

func TestRunHappyPaths(t *testing.T) {
	code, out, errs := runCLI(t, "fixtures/app.jsonl")
	if code != 0 || !strings.Contains(out, "db query failed ×3") || !strings.Contains(errs, "json format") {
		t.Errorf("app.log full run: code=%d out=%q err=%q", code, out, errs)
	}
	// flags AFTER the positional: grep users type it this way (reorderArgs)
	code, out, errs = runCLI(t, "fixtures/app.jsonl", "-level", "error,warn")
	if code != 0 || strings.Contains(out, "service start") || !strings.Contains(out, "payments worker crashed") {
		t.Errorf("flags-after-file: code=%d out=%q", code, out)
	}
	code, _, _ = runCLI(t, "fixtures/app.jsonl", "-level", "fatal")
	if code != 1 {
		t.Errorf("no matches must exit 1, got %d", code)
	}
}

func TestRunCannotCheckTrichotomy(t *testing.T) {
	if code, _, errs := runCLI(t, "/no/such/file.log"); code != 2 || !strings.Contains(errs, "cannot read") {
		t.Errorf("missing file: %d %q", code, errs)
	}
	if code, _, errs := runCLI(t, "-level", "bogus", "fixtures/app.jsonl"); code != 2 || !strings.Contains(errs, "unknown level") {
		t.Errorf("unknown level: %d %q", code, errs)
	}
	if code, _, errs := runCLI(t, "-since", "notatime", "fixtures/app.jsonl"); code != 2 || !strings.Contains(errs, "not a duration") {
		t.Errorf("bad since: %d %q", code, errs)
	}
	inert := filepath.Join(t.TempDir(), "inert.log")
	os.WriteFile(inert, []byte("no structure\nat all\n"), 0o644)
	if code, _, errs := runCLI(t, inert, "-level", "error"); code != 2 || !strings.Contains(errs, "no line") {
		t.Errorf("inert + level filter must be a cannot-check: %d %q", code, errs)
	}
	if code, _, errs := runCLI(t, inert, "-since", "5m"); code != 2 || !strings.Contains(errs, "no line") {
		t.Errorf("inert + window must be a cannot-check: %d %q", code, errs)
	}
	// inert WITHOUT filters still shows everything, exit 0
	if code, out, _ := runCLI(t, inert); code != 0 || !strings.Contains(out, "no structure") {
		t.Errorf("inert unfiltered: %d %q", code, out)
	}
}

func TestRunTimelessRecordCountedNotDropped(t *testing.T) {
	// app.log has one timeless record ({"level":"warn","msg":"heartbeat missed"});
	// with a window it must be counted in the footer, never silently gone
	code, _, errs := runCLI(t, "fixtures/app.jsonl", "-since", "30m")
	if code == 2 || !strings.Contains(errs, "1 timeless") {
		t.Errorf("timeless record: %q", errs)
	}
}

// ---------- subprocess runs: the real binary, real exit codes ----------

var binPath string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "loglens-test-")
	if err != nil {
		panic(err)
	}
	binPath = filepath.Join(dir, "loglens")
	out, err := exec.Command("go", "build", "-o", binPath, "loglens.go").CombinedOutput()
	if err != nil {
		panic("build failed: " + string(out))
	}
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func TestSubprocessExitMatrix(t *testing.T) {
	cases := []struct {
		name string
		args []string
		want int
	}{
		{"match", []string{"fixtures/app.jsonl", "-level", "error"}, 0},
		{"no-match", []string{"fixtures/app.jsonl", "-level", "fatal"}, 1},
		{"missing-file", []string{"/no/such/file.log"}, 2},
		{"unknown-flag", []string{"-bogus", "fixtures/app.jsonl"}, 2},
		{"help", []string{"-h"}, 0},
	}
	for _, c := range cases {
		cmd := exec.Command(binPath, c.args...)
		var out, errb bytes.Buffer
		cmd.Stdout, cmd.Stderr = &out, &errb
		if err := cmd.Run(); err == nil && c.want != 0 {
			t.Errorf("%s: exit 0, want %d", c.name, c.want)
		}
		if code := cmd.ProcessState.ExitCode(); code != c.want { // ProcessState set even on non-zero exit
			t.Errorf("%s: exit %d, want %d (stderr %q)", c.name, code, c.want, errb.String())
		}
		if c.name == "unknown-flag" && !strings.Contains(errb.String(), "flag provided but not defined") {
			t.Errorf("unknown flag must name the flag: %q", errb.String())
		}
	}
}

func TestSubprocessStdinAndCleanStdout(t *testing.T) {
	// pipe JSON in: stdin mode works, stdout carries ONLY records (footer on
	// stderr) so `loglens - | wc -l` counts records, not report noise
	cmd := exec.Command(binPath, "-")
	cmd.Stdin = strings.NewReader(`{"time":"2026-11-04T10:04:11Z","level":"error","msg":"boom"}` + "\n")
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	if code := cmd.ProcessState.ExitCode(); code != 0 {
		t.Errorf("stdin run exit %d", code)
	}
	if strings.Contains(out.String(), "loglens —") || !strings.Contains(out.String(), "boom") {
		t.Errorf("stdout must be records only: %q", out.String())
	}
	if !strings.Contains(errb.String(), "loglens —") {
		t.Errorf("footer must live on stderr: %q", errb.String())
	}
}
