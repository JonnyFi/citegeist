"""Watchlists: background only on request, library-scoped agents without secrets, diffs of re-runs."""

import importlib
import json
import os
import plistlib
import shutil

import pytest
from conftest import FIXTURES


@pytest.fixture()
def watch(library_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("CITEGEIST_LIBRARY_ID", "lib-123")
    monkeypatch.setenv("CITEGEIST_KEYCHAIN_SERVICE", "citegeist")
    monkeypatch.setenv("OPENALEX_API_KEY", "secret-key-never-in-plist")
    w = importlib.import_module("watch")
    calls = []
    monkeypatch.setattr(w, "AGENTS_DIR", str(tmp_path / "LaunchAgents"))
    monkeypatch.setattr(w, "SCHEDULER", True)
    monkeypatch.setattr(w, "_launchctl", lambda *a: calls.append(a) or type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})())
    monkeypatch.setattr(w, "notify", lambda *a, **k: None)
    monkeypatch.setattr(w.preprints, "sync_from_runs", lambda *a: None)
    w.calls = calls
    runs = library_dir / "runs"
    runs.mkdir()
    shutil.copytree(os.path.join(FIXTURES, "run-sample"), runs / "run-sample")
    return w


def test_a_new_watchlist_runs_only_on_request(watch):
    # protects: saving a watchlist installs no LaunchAgent; background stays off until the user turns it on
    # fails_when: a plist appears or launchctl is called on save
    # no_claim: launchctl is a stand-in; the real launchd is not touched
    wl = watch.save(from_run="run-sample", weekday=1, at="8:05")
    assert wl["paused"] is True
    assert wl["queries"] == ['"agent communication protocol"', '"multi-agent communication" LLM']
    assert wl["time"] == "08:05"
    assert not os.path.exists(watch.AGENTS_DIR)
    assert watch.calls == []


def test_background_installs_a_library_scoped_agent_without_the_key(watch):
    # protects: the agent's label names the library; its plist carries the folders and Keychain service, never the key
    # fails_when: two libraries could share a label, the key lands in the plist, or "off" leaves the plist behind
    # no_claim: launchctl is a stand-in; whether launchd starts it on time is not tested
    wl = watch.save(topic="agents", queries=["a b"], weekday=3, at="07:30")
    watch.background(wl["id"], True)
    path = watch.plist_path(wl["id"])
    assert os.path.basename(path) == "app.citegeist.litsearch.lib-123.agents.plist"
    with open(path, "rb") as f:
        plist = plistlib.load(f)
    assert plist["StartCalendarInterval"] == {"Weekday": 3, "Hour": 7, "Minute": 30}
    cmd = plist["ProgramArguments"][-1]
    assert "CITEGEIST_LITSEARCH_DIR=" in cmd and "CITEGEIST_KEYCHAIN_SERVICE='citegeist'" in cmd
    assert "secret-key-never-in-plist" not in cmd
    assert watch.get(wl["id"])["paused"] is False
    watch.background(wl["id"], False)
    assert not os.path.exists(path)
    assert watch.get(wl["id"])["paused"] is True


def test_record_books_a_run_with_new_and_dropped_papers(watch, library_dir):
    # protects: a re-run lists the papers its predecessor lacked (watch.json) and counts them as unseen
    # fails_when: the base run is not used, a known paper counts as new, or "seen" does not reset the count
    # no_claim: the second run is the fixture with one paper removed and one added by hand
    wl = watch.save(from_run="run-sample", weekday=1, at="08:00")
    newer = library_dir / "runs" / "run-newer"
    shutil.copytree(library_dir / "runs" / "run-sample", newer)
    rows = (newer / "papers.csv").read_text(encoding="utf-8-sig").splitlines()
    header, kept = rows[0], [r for r in rows[1:] if "Emergent Communication" not in r]
    added = rows[1].replace("A Survey of Agent Interoperability Protocols", "Brand New Agent Protocol Paper") \
                   .replace("10.1145/3700001", "10.1/new").replace("W4400000001", "W5000000009")
    (newer / "papers.csv").write_text("\n".join([header, *kept, added]) + "\n", encoding="utf-8")
    result = watch.record(wl["id"], "run-newer")
    assert [p["title"] for p in result["new"]] == ["Brand New Agent Protocol Paper"]
    assert [p["title"] for p in result["dropped"]] == ["Emergent Communication in Multi-Agent Reinforcement Learning"]
    assert json.loads((newer / "watch.json").read_text())["previous"] == "run-sample"
    booked = watch.get(wl["id"])
    assert booked["runs"] == ["run-newer"] and booked["last_new"] == 1
    watch.update(wl["id"], last_visit="2000-01-01T00:00:00")
    assert watch.unseen(watch.get(wl["id"])) == 1
    watch.seen(wl["id"])
    assert watch.unseen(watch.get(wl["id"])) == 0
