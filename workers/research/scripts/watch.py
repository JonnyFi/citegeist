#!/usr/bin/env python3
"""Watchlists of the citegeist literature search: saved searches, re-run weekly by launchd if wanted.

Usage:
  python3 watch.py list [--json]
  python3 watch.py save [--id ID] [--from-run RUN] --topic T --query Q ... --weekday 1 --time 08:00
                        [--since YEAR] [--top N]                      # prints the watchlist as JSON
  python3 watch.py background ID on|off          # install or remove the weekly LaunchAgent
  python3 watch.py seen ID                       # the user looked at the new papers
  python3 watch.py run ID [--scheduled]          # one re-run now (what the LaunchAgent calls)
  python3 watch.py record ID RUN                 # book a run the app started on the watchlist
  python3 watch.py delete ID

Each watchlist stores a topic, queries and settings in <library>/research/watches/watchlists.json.
A new watchlist runs only on request: the weekly LaunchAgent exists only while "background" is on
(stored as paused = false, the field research-pipeline used). A re-run writes a normal run folder,
compares it with the watchlist's previous run (watch.json: new and dropped papers), checks tracked
preprints, and posts a macOS notification when something new turned up. The agent reads the
OpenAlex key from the Keychain (settings.py); no secret is written into its plist.
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
import socket
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
# one label namespace per library, so two libraries with a watchlist of the same name do not collide
LIBRARY_ID = re.sub(r"[^A-Za-z0-9-]", "", os.environ.get("CITEGEIST_LIBRARY_ID", "")) or "library"
LABEL_PREFIX = f"app.citegeist.litsearch.{LIBRARY_ID}."
# what a LaunchAgent needs to find the library and the key (never the key itself)
AGENT_ENV = ("CITEGEIST_LITSEARCH_DIR", "CITEGEIST_LITSEARCH_CACHE", "CITEGEIST_KEYCHAIN_SERVICE",
             "CITEGEIST_LIBRARY_ID", "OPENDRAFT_CONTACT_EMAIL", "SSL_CERT_FILE", "PYTHONDONTWRITEBYTECODE")
# weekly re-runs and notifications need launchd and osascript; tests switch both off
SCHEDULER = sys.platform == "darwin" and not os.environ.get("CITEGEIST_LITSEARCH_NO_LAUNCHD")
WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]  # launchd: 0 = Sunday


HOST = socket.gethostname()  # same value as os.hostname() in Node, which compares it with running_host


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


def save(wid=None, from_run=None, topic=None, queries=None, since=None, top=None, weekday=1, at="08:00"):
    """Create a watchlist (background off) or change one; a running agent follows a new schedule."""
    weekday, at = check_schedule(weekday, at)
    if from_run and not queries:
        meta = read_json(os.path.join(RUNS_DIR, from_run, "run.json")) or {}
        topic, queries = topic or meta.get("topic"), meta.get("queries")
        since, top = since if since is not None else meta.get("since"), top if top is not None else meta.get("top")
    queries = [" ".join(q.split()) for q in queries or [] if q and q.strip()]
    if not topic or not queries:
        raise ValueError("Thema und mindestens eine Suchanfrage nötig")
    fields = {"topic": topic, "queries": queries, "since": since, "top": top, "weekday": weekday, "time": at}
    if wid:
        wl = update(wid, **fields)
        if not wl:
            raise ValueError(f"keine Beobachtung {wid}")
        if not wl["paused"]:
            install(wl)
        return wl
    with locked() as data:
        base, n, ids = slugify(topic, 40), 2, {w["id"] for w in data["watchlists"]}
        wid = base
        while wid in ids:
            wid, n = f"{base}-{n}", n + 1
        wl = {"id": wid, **fields, "paused": True, "created": now(), "base_run": from_run, "runs": [],
              "last_run": None, "last_status": None, "last_new": None, "last_visit": now(), "running_pid": None, "running_host": None}
        data["watchlists"].append(wl)
    if from_run:
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


def background(wid, on):
    """Turn the weekly LaunchAgent on (install) or off (remove)."""
    if on:
        wl = update(wid, paused=False)
        if wl:
            install(wl)
        return wl
    uninstall(wid)
    return update(wid, paused=True)


def seen(wid):
    return update(wid, last_visit=now())


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
    env = "".join(f"{k}={_sh(os.environ[k])} " for k in AGENT_ENV if os.environ.get(k))
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
            "counts": {}, "attempts": 1, "watchlist": wl["id"], "pid": os.getpid(), "host": HOST}
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
    meta.pop("host", None)
    write_json(os.path.join(path, "run.json"), meta)
    return run_id, status


def record(wid, run_id, status=None, notify_user=False):
    """Book a finished run on its watchlist: watch.json with new and dropped papers, last_* fields."""
    wl = get(wid)
    if not wl:
        raise ValueError(f"keine Beobachtung {wid}")
    meta = read_json(os.path.join(RUNS_DIR, run_id, "run.json")) or {}
    status = status or meta.get("status") or "failed"
    prev = next((r for r in reversed(wl["runs"]) if r != run_id and (read_json(os.path.join(RUNS_DIR, r, "run.json")) or {})
                 .get("status") == "done"), wl.get("base_run"))
    result = {"watchlist": wid, "created": now(), "status": status}
    if status == "done" and prev and prev != run_id and os.path.isdir(os.path.join(RUNS_DIR, prev)):
        result.update(diff(prev, run_id))
    write_json(os.path.join(RUNS_DIR, run_id, "watch.json"), result)
    n_new = len(result.get("new") or [])
    with locked() as data:
        for w in data["watchlists"]:
            if w["id"] == wid:
                if run_id not in w["runs"]:
                    w["runs"].append(run_id)
                w.update(last_run=now(), last_status=status, last_new=n_new if status == "done" else None)
    log(f"{wid}: {status}, {n_new} new, {len(result.get('dropped') or [])} dropped (vs {prev})")
    if notify_user and status == "done" and n_new:
        notify("citegeist", f"{n_new} neue{'s' if n_new == 1 else ''} Paper zu {wl['topic']}",
               subtitle="Literatursuche · Beobachtung")
    elif notify_user and status != "done":
        notify("citegeist", f"Beobachtung „{wl['topic']}“: Lauf fehlgeschlagen", subtitle="Details in der Literatursuche")
    return result


def unseen(wl):
    """New papers in the watchlist's runs since the user last looked."""
    total = 0
    for r in wl.get("runs") or []:
        w = read_json(os.path.join(RUNS_DIR, r, "watch.json")) or {}
        if w.get("created", "") > (wl.get("last_visit") or ""):
            total += len(w.get("new") or [])
    return total


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
    # the pid and host are synced with the library: a pid of another Mac says nothing about this one
    if pid and wl.get("running_host") == HOST and pid != os.getpid() and _alive(pid):
        log(f"{wid}: already running (pid {pid})")
        return 0
    update(wid, running_pid=os.getpid(), running_host=HOST, running_since=now())
    status = "failed"
    try:
        run_id, status = execute(wl)
        record(wid, run_id, status, notify_user=True)
    finally:
        update(wid, running_pid=None, running_host=None)
    # preprint tracking rides along with every weekly run
    try:
        preprints.sync_from_runs(RUNS_DIR)
        found = preprints.check()
        for item in found:
            log("preprint published: " + preprints.report(item))
        if found:
            notify("citegeist", preprints.report(found[0]) if len(found) == 1 else
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
    sub.add_parser("list").add_argument("--json", action="store_true")
    sv = sub.add_parser("save")
    sv.add_argument("--id")
    sv.add_argument("--from-run")
    sv.add_argument("--topic")
    sv.add_argument("--query", action="append")
    sv.add_argument("--since", type=int)
    sv.add_argument("--top", type=int)
    sv.add_argument("--weekday", type=int, required=True, help="0 = Sunday ... 6 = Saturday")
    sv.add_argument("--time", required=True, help="HH:MM")
    bg = sub.add_parser("background")
    bg.add_argument("id")
    bg.add_argument("state", choices=["on", "off"])
    r = sub.add_parser("run")
    r.add_argument("id")
    r.add_argument("--scheduled", action="store_true", help="called by launchd: skip if paused")
    rec = sub.add_parser("record")
    rec.add_argument("id")
    rec.add_argument("run")
    for name in ("seen", "delete"):
        sub.add_parser(name).add_argument("id")
    args = ap.parse_args()
    try:
        if args.cmd == "list":
            items = [{**w, "agent": agent_loaded(w["id"]), "unseen": unseen(w)} for w in load()]
            if args.json:
                print(json.dumps({"watchlists": items}, ensure_ascii=False))
            for w in items if not args.json else []:
                state = "background off" if w["paused"] else "active" if w["agent"] else "agent missing"
                print(f"{w['id']}: {w['topic']} · {WEEKDAYS[w['weekday']]} {w['time']} · {state} · {len(w['runs'])} runs")
        elif args.cmd == "save":
            print(json.dumps(save(args.id, args.from_run, args.topic, args.query, args.since, args.top,
                                  args.weekday, args.time), ensure_ascii=False))
        elif args.cmd == "background":
            print(json.dumps(background(args.id, args.state == "on"), ensure_ascii=False))
        elif args.cmd == "run":
            sys.exit(run_watch(args.id, args.scheduled))
        elif args.cmd == "record":
            print(json.dumps(record(args.id, args.run), ensure_ascii=False))
        elif args.cmd == "seen":
            print(json.dumps(seen(args.id), ensure_ascii=False))
        else:
            print(json.dumps({"deleted": delete(args.id)}))
    except (ValueError, RuntimeError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
