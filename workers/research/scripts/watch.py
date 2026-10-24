#!/usr/bin/env python3
"""Research Pipeline watchlists: weekly re-runs of a saved search, via a launchd LaunchAgent.

Usage:
  python3 watch.py list
  python3 watch.py run ID [--scheduled]          # one re-run now (what the LaunchAgent calls)
  python3 watch.py schedule ID --weekday 1 --time 08:00
  python3 watch.py pause ID | resume ID | delete ID

Each watchlist stores a run's topic, queries and settings. A re-run writes a normal run folder
to the runs directory, compares it with the watchlist's previous run (watch.json: new and dropped
papers), checks all tracked preprints for a published version, and posts a macOS notification
when something new turned up. The LaunchAgent runs `zsh -l -c ...`, so OPENALEX_API_KEY and
OPENDRAFT_CONTACT_EMAIL from the login profile are set.
"""

import argparse
import contextlib
import csv
import datetime
import fcntl
import json
import os
import plistlib
import re
import subprocess
import sys
import time

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
import settings  # noqa: E402  (data folders; imports nothing of ours)

import preprints  # noqa: E402
import sources  # noqa: E402

SCRIPT = os.path.join(SKILL_DIR, "scripts", "pipeline.py")
RUNS_DIR = settings.RUNS_DIR
WATCH_DIR = settings.WATCH_DIR
AGENTS_DIR = os.path.expanduser("~/Library/LaunchAgents")
LABEL_PREFIX = "com.research-pipeline.watch."
LEGACY_LABEL_PREFIX = "com.lit-scout.watch."
SCHEDULER = sys.platform == "darwin"  # weekly re-runs and notifications need launchd and osascript
WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]  # launchd: 0 = Sunday


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def log(msg):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def slugify(text, max_len=60):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:max_len].rstrip("-") or "run"


# --- storage (shared by the GUI and the LaunchAgent, so every change holds a file lock) -----

STORE = os.path.join(WATCH_DIR, "watchlists.json")


@contextlib.contextmanager
def locked():
    """Read-modify-write the watchlist store under an exclusive lock; yields the data dict."""
    os.makedirs(WATCH_DIR, exist_ok=True)
    with open(os.path.join(WATCH_DIR, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = read_json(STORE, {"watchlists": []})
        yield data
        write_json(STORE, data)


def load():
    return read_json(STORE, {"watchlists": []})["watchlists"]


def get(wid):
    return next((w for w in load() if w["id"] == wid), None)


def update(wid, **fields):
    with locked() as data:
        for w in data["watchlists"]:
            if w["id"] == wid:
                w.update(fields)
                return dict(w)
    return None


def create(run_id, weekday, at):
    """Save a finished run's topic, queries and settings as a watchlist and install its LaunchAgent."""
    meta = read_json(os.path.join(RUNS_DIR, run_id, "run.json")) or {}
    if not meta.get("queries"):
        raise ValueError("Lauf ohne gespeicherte Suchanfragen")
    weekday, at = check_schedule(weekday, at)
    with locked() as data:
        base, n, ids = slugify(meta.get("topic") or run_id, 40), 2, {w["id"] for w in data["watchlists"]}
        wid = base
        while wid in ids:
            wid, n = f"{base}-{n}", n + 1
        wl = {"id": wid, "topic": meta.get("topic") or run_id, "queries": meta["queries"],
              "since": meta.get("since"), "top": meta.get("top"), "weekday": weekday, "time": at,
              "paused": False, "created": now(), "base_run": run_id, "runs": [], "last_run": None,
              "last_status": None, "last_new": None, "last_visit": now(), "running_pid": None}
        data["watchlists"].append(wl)
    install(wl)
    preprints.sync_from_runs(RUNS_DIR)
    return wl


def check_schedule(weekday, at):
    weekday = int(weekday)
    if not 0 <= weekday <= 6:
        raise ValueError("Wochentag 0–6 (0 = Sonntag)")
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(at or "").strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise ValueError("Uhrzeit als HH:MM")
    return weekday, f"{int(m.group(1)):02d}:{m.group(2)}"


def schedule(wid, weekday, at):
    weekday, at = check_schedule(weekday, at)
    wl = update(wid, weekday=weekday, time=at)
    if wl and not wl["paused"]:
        install(wl)
    return wl


def pause(wid):
    uninstall(wid)
    return update(wid, paused=True)


def resume(wid):
    wl = update(wid, paused=False)
    if wl:
        install(wl)
    return wl


def delete(wid):
    """Remove the watchlist and its LaunchAgent; its run folders stay."""
    uninstall(wid)
    with locked() as data:
        before = len(data["watchlists"])
        data["watchlists"] = [w for w in data["watchlists"] if w["id"] != wid]
        return len(data["watchlists"]) < before


# --- launchd ------------------------------------------------------------------------------

def label(wid):
    return LABEL_PREFIX + wid


def plist_path(wid):
    return os.path.join(AGENTS_DIR, label(wid) + ".plist")


def _launchctl(*args):
    return subprocess.run(["launchctl", *args], capture_output=True, text=True)


def install(wl):
    """Write the LaunchAgent plist and (re)load it: weekly at the watchlist's weekday and time."""
    if not SCHEDULER:
        return
    os.makedirs(AGENTS_DIR, exist_ok=True)
    os.makedirs(os.path.join(WATCH_DIR, "logs"), exist_ok=True)
    hour, minute = map(int, wl["time"].split(":"))
    env = "".join(f"{k}={_sh(os.environ[k])} " for k in ("RESEARCH_PIPELINE_DATA_DIR", "RESEARCH_PIPELINE_RUNS_DIR", "RESEARCH_PIPELINE_WATCH_DIR", "LIT_SCOUT_RUNS_DIR", "LIT_SCOUT_WATCH_DIR", "SSL_CERT_FILE") if os.environ.get(k))
    cmd = f"exec env {env}{_sh(sys.executable)} {_sh(os.path.abspath(__file__))} run {_sh(wl['id'])} --scheduled"
    logf = os.path.join(WATCH_DIR, "logs", f"{wl['id']}.log")
    plist = {"Label": label(wl["id"]), "ProgramArguments": ["/bin/zsh", "-l", "-c", cmd],
             "StartCalendarInterval": {"Weekday": wl["weekday"], "Hour": hour, "Minute": minute},
             "StandardOutPath": logf, "StandardErrorPath": logf, "RunAtLoad": False, "ProcessType": "Background"}
    uninstall(wl["id"], keep_file=True)
    with open(plist_path(wl["id"]), "wb") as f:
        plistlib.dump(plist, f)
    res = _launchctl("bootstrap", f"gui/{os.getuid()}", plist_path(wl["id"]))
    if res.returncode != 0:
        raise RuntimeError(f"launchctl bootstrap failed: {(res.stderr or res.stdout).strip()}")


def uninstall(wid, keep_file=False):
    if not SCHEDULER:
        return
    _launchctl("bootout", f"gui/{os.getuid()}/{label(wid)}")  # fails harmlessly when not loaded
    if not keep_file and os.path.exists(plist_path(wid)):
        os.remove(plist_path(wid))


def migrate_agents():
    """Replace LaunchAgents from before the rename (com.lit-scout.watch.*) with ones under the new label."""
    if not SCHEDULER or not os.path.isdir(AGENTS_DIR):
        return []
    moved = []
    for name in sorted(os.listdir(AGENTS_DIR)):
        if not (name.startswith(LEGACY_LABEL_PREFIX) and name.endswith(".plist")):
            continue
        wid = name[len(LEGACY_LABEL_PREFIX):-len(".plist")]
        _launchctl("bootout", f"gui/{os.getuid()}/{LEGACY_LABEL_PREFIX}{wid}")
        os.remove(os.path.join(AGENTS_DIR, name))
        wl = get(wid)
        if wl and not wl["paused"]:
            install(wl)
            moved.append(wid)
    return moved


def agent_loaded(wid):
    if not SCHEDULER:
        return False
    return _launchctl("print", f"gui/{os.getuid()}/{label(wid)}").returncode == 0


def _sh(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


# --- one re-run -----------------------------------------------------------------------------

def match_keys(p):
    """Same matching as the GUI's compare view: DOI, OpenAlex id, normalised title."""
    doi = (p.get("verified_doi") or p.get("doi") or "").lower()
    title = re.sub(r"[^\w]+", " ", (p.get("title") or "").lower()).strip()
    return [k for k in (doi and f"doi:{doi}", p.get("openalex_id") and f"oa:{p['openalex_id']}",
                        len(title) > 15 and f"t:{title}") if k]


def load_papers(run_id):
    try:
        with open(os.path.join(RUNS_DIR, run_id, "papers.csv"), encoding="utf-8-sig", newline="") as f:
            return [r for r in csv.DictReader(f) if r.get("section") != "rejected"]
    except OSError:
        return []


def diff(prev_id, new_id):
    """Papers in the new run that the previous run did not have, and the ones it lost."""
    import papers  # paper_key lives there; imported late to keep watch.py light for launchd
    old, new = load_papers(prev_id), load_papers(new_id)
    seen = {k for p in old for k in match_keys(p)}
    now_keys = {k for p in new for k in match_keys(p)}
    added = [p for p in new if not any(k in seen for k in match_keys(p))]
    dropped = [p for p in old if not any(k in now_keys for k in match_keys(p))]
    brief = lambda p: {"key": papers.paper_key(p), "title": p.get("title", ""), "section": p.get("section"),  # noqa: E731
                       "rank": p.get("rank"), "year": p.get("year"), "venue": p.get("venue"),
                       "doi": p.get("verified_doi") or p.get("doi")}
    return {"previous": prev_id, "new": [brief(p) for p in added], "dropped": [brief(p) for p in dropped]}


def new_run_folder(topic):
    os.makedirs(RUNS_DIR, exist_ok=True)
    base = f"{datetime.date.today().isoformat()}-{slugify(topic)}"
    run_id, n = base, 2
    while os.path.exists(os.path.join(RUNS_DIR, run_id)):
        run_id, n = f"{base}-{n}", n + 1
    os.makedirs(os.path.join(RUNS_DIR, run_id))
    return run_id


def execute(wl):
    """Run pipeline.py like the GUI does (same files), return (run_id, status)."""
    queries, dropped = sources.plan_queries(wl["queries"])
    run_id = new_run_folder(wl["topic"])
    path = os.path.join(RUNS_DIR, run_id)
    meta = {"id": run_id, "topic": wl["topic"], "queries": queries, "dropped_queries": dropped,
            "since": wl.get("since"), "top": wl.get("top"), "created": now(), "status": "running",
            "counts": {}, "attempts": 1, "watchlist": wl["id"], "pid": os.getpid()}
    write_json(os.path.join(path, "run.json"), meta)
    cmd = [sys.executable, "-u", SCRIPT, "--topic", wl["topic"], "--out", path, "--progress-jsonl",
           "--query-cache", os.path.join(path, "query-cache")]
    for q in queries:
        cmd += ["--query", q]
    if wl.get("since"):
        cmd += ["--since", str(wl["since"])]
    if wl.get("top"):
        cmd += ["--top", str(wl["top"])]
    log(f"{wl['id']}: run {run_id} ({len(queries)} queries)")
    saw_done = False
    with open(os.path.join(path, "progress.jsonl"), "w", encoding="utf-8") as out, \
            open(os.path.join(path, "stderr.log"), "w", encoding="utf-8") as err:
        proc = subprocess.Popen(cmd, cwd=path, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=err,
                                text=True, encoding="utf-8", bufsize=1)
        for line in proc.stdout:
            out.write(line)
            out.flush()
            if '"type": "done"' in line:
                saw_done = True
                meta["counts"] = (json.loads(line).get("counts") or {})
        rc = proc.wait()
        status = "done" if rc == 0 and saw_done else "failed"
        out.write(json.dumps({"type": "end", "status": status, "returncode": rc, "t": round(time.time(), 3)}) + "\n")
    meta.update(status=status, finished=now())
    meta.pop("pid", None)
    write_json(os.path.join(path, "run.json"), meta)
    return run_id, status


def notify(title, message, subtitle=""):
    """macOS notification through osascript (works from a LaunchAgent in the user session)."""
    if not SCHEDULER:
        return
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')  # noqa: E731
    script = f'display notification "{esc(message)}" with title "{esc(title)}"'
    if subtitle:
        script += f' subtitle "{esc(subtitle)}"'
    script += ' sound name "Glass"'
    res = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    log(f"notification {'sent' if res.returncode == 0 else 'failed: ' + res.stderr.strip()}: {message}")


def run_watch(wid, scheduled=False):
    wl = get(wid)
    if not wl:
        log(f"{wid}: watchlist not found")
        return 1
    if scheduled and wl.get("paused"):
        log(f"{wid}: paused, skipped")
        return 0
    pid = wl.get("running_pid")
    if pid and pid != os.getpid() and _alive(pid):
        log(f"{wid}: already running (pid {pid})")
        return 0
    update(wid, running_pid=os.getpid(), running_since=now())
    status = "failed"
    try:
        prev = next((r for r in reversed(wl["runs"]) if (read_json(os.path.join(RUNS_DIR, r, "run.json")) or {})
                     .get("status") == "done"), wl.get("base_run"))
        run_id, status = execute(wl)
        result = {"watchlist": wid, "created": now(), "status": status}
        if status == "done" and prev and os.path.isdir(os.path.join(RUNS_DIR, prev)):
            result.update(diff(prev, run_id))
        write_json(os.path.join(RUNS_DIR, run_id, "watch.json"), result)
        n_new = len(result.get("new") or [])
        with locked() as data:
            for w in data["watchlists"]:
                if w["id"] == wid:
                    w["runs"].append(run_id)
                    w.update(last_run=now(), last_status=status, last_new=n_new if status == "done" else None)
        log(f"{wid}: {status}, {n_new} new, {len(result.get('dropped') or [])} dropped (vs {prev})")
        if status == "done" and n_new:
            notify("Research Pipeline", f"{n_new} neue{'s' if n_new == 1 else ''} Paper zu {wl['topic']}",
                   subtitle="Beobachtung · wöchentlicher Lauf")
        elif status != "done":
            notify("Research Pipeline", f"Beobachtung „{wl['topic']}“: Lauf fehlgeschlagen", subtitle="Details im Laufordner")
    finally:
        update(wid, running_pid=None)
    # preprint tracking rides along with every weekly run
    try:
        preprints.sync_from_runs(RUNS_DIR)
        found = preprints.check()
        for item in found:
            log("preprint published: " + preprints.report(item))
        if found:
            notify("Research Pipeline", preprints.report(found[0]) if len(found) == 1 else
                   f"{len(found)} Preprints sind jetzt erschienen oder angenommen", subtitle="Preprint-Tracking")
    except Exception as e:  # the watch run itself is done; do not fail it over the preprint check
        log(f"preprint check failed: {type(e).__name__}: {e}")
    return 0 if status == "done" else 1


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, TypeError):
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    r = sub.add_parser("run")
    r.add_argument("id")
    r.add_argument("--scheduled", action="store_true", help="called by launchd: skip if paused")
    s = sub.add_parser("schedule")
    s.add_argument("id")
    s.add_argument("--weekday", type=int, required=True, help="0 = Sunday ... 6 = Saturday")
    s.add_argument("--time", required=True, help="HH:MM")
    for name in ("pause", "resume", "delete"):
        sub.add_parser(name).add_argument("id")
    args = ap.parse_args()
    if args.cmd == "list":
        for w in load():
            state = "paused" if w["paused"] else "active" if agent_loaded(w["id"]) else "agent missing"
            print(f"{w['id']}: {w['topic']} · {WEEKDAYS[w['weekday']]} {w['time']} · {state} · {len(w['runs'])} runs")
    elif args.cmd == "run":
        sys.exit(run_watch(args.id, args.scheduled))
    elif args.cmd == "schedule":
        print(schedule(args.id, args.weekday, args.time))
    else:
        print({"pause": pause, "resume": resume, "delete": delete}[args.cmd](args.id))


if __name__ == "__main__":
    main()
