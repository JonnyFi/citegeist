"""Foundation of the literature search worker: data folders, TLS, the papers module, dropped features."""

import importlib
import os
import re
import shutil
import subprocess
import sys

from conftest import FIXTURES, ROOT, SCRIPT_MODULES, SCRIPTS


def test_settings_put_every_folder_under_the_library(library_dir):
    # protects: runs, preprint lists and opendraft output land in <library>/research
    # fails_when: a folder falls back to ~/research or the program folder
    # no_claim: the folders are not created here; pipeline.py and preprints.py create them on use
    settings = importlib.import_module("settings")
    for name in ("RUNS_DIR", "WATCH_DIR", "PROJECTS_DIR", "LATEX_DIR"):
        assert getattr(settings, name).startswith(str(library_dir)), name
    assert settings.RUNS_DIR == os.path.join(str(library_dir), "runs")
    assert settings.WATCH_DIR == os.path.join(str(library_dir), "watches")


def test_cache_is_machine_local_not_in_the_program_folder(library_dir, tmp_path):
    # protects: lookup caches go where citegeist points them, writable in the packaged app
    # fails_when: CACHE_DIR points into workers/research (read-only inside citegeist.app)
    # no_claim: the 30-day TTL of the cache is not tested here
    settings = importlib.import_module("settings")
    extra = importlib.import_module("extra_sources")
    assert settings.CACHE_DIR == str(tmp_path / "cache")
    assert extra.CACHE_DIR == settings.CACHE_DIR
    assert not settings.CACHE_DIR.startswith(ROOT)


def test_scripts_refuse_to_run_without_a_library(tmp_path):
    # protects: nothing is ever written outside a library
    # fails_when: settings falls back to a global folder when the variable is missing
    # no_claim: none beyond protects
    env = {k: v for k, v in os.environ.items() if k != "CITEGEIST_LITSEARCH_DIR"}
    res = subprocess.run([sys.executable, "-c", "import settings"], cwd=SCRIPTS, env=env,
                         capture_output=True, text=True)
    assert res.returncode != 0
    assert "CITEGEIST_LITSEARCH_DIR" in res.stderr


def test_ca_bundle_defaults_to_the_macos_system_roots(monkeypatch):
    # protects: HTTPS works with Pythons that ship without CA certificates (the failed legacy runs)
    # fails_when: SSL_CERT_FILE stays unset although /etc/ssl/cert.pem exists, or an explicit value is overwritten
    # no_claim: a live HTTPS request is not made here; that was checked by hand against OpenAlex
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    importlib.import_module("settings")
    if os.path.isfile("/etc/ssl/cert.pem"):
        assert os.environ["SSL_CERT_FILE"] == "/etc/ssl/cert.pem"
    sys.modules.pop("settings")
    monkeypatch.setenv("SSL_CERT_FILE", "/custom/ca.pem")
    importlib.import_module("settings")
    assert os.environ["SSL_CERT_FILE"] == "/custom/ca.pem"


def test_every_script_imports(library_dir):
    # protects: no script still imports a dropped module (scite, matrix, readinglist)
    # fails_when: an import raises
    # no_claim: imports only; the scripts' behaviour is covered elsewhere
    for name in sorted(SCRIPT_MODULES):
        importlib.import_module(name)


def test_dropped_features_are_gone():
    # protects: scite, the pipeline's own matrix and reading list are not shipped (citegeist has its own)
    # fails_when: a file or a reference to them comes back
    # no_claim: `claude` stays allowed in opendraft_bridge.py (the "write the paper" command); not checked here
    for name in ("scite.py", "matrix.py", "readinglist.py"):
        assert not os.path.exists(os.path.join(SCRIPTS, name))
    pattern = re.compile(r"\bimport (scite|matrix|readinglist)\b|\bscite\.|\breadinglist\.|claude -p")
    for f in os.listdir(SCRIPTS):
        if f.endswith(".py"):
            with open(os.path.join(SCRIPTS, f), encoding="utf-8") as fh:
                assert not pattern.search(fh.read()), f
    assert os.path.isfile(os.path.join(ROOT, "vendor", "opendraft", "LICENSE"))
    assert os.path.isfile(os.path.join(ROOT, "vendor", "opendraft", "THIRD_PARTY_NOTICES.md"))


def test_papers_keys_and_topic_from_a_run(tmp_path):
    # protects: the alert diffs and the opendraft handover find papers by the same key as before
    # fails_when: a key changes (OpenAlex id, else sha1 of DOI/title) or a row is lost
    # no_claim: the fixture is written by render.write_csv from hand-made rows, not by a live run
    papers = importlib.import_module("papers")
    run = tmp_path / "run"
    shutil.copytree(os.path.join(FIXTURES, "run-sample"), run)
    rows = papers.load_papers(str(run))
    assert list(rows)[:3] == ["W4400000001", "W4200000002", "W4600000003"]
    grey = [k for k, p in rows.items() if p["section"] == "grey"]
    assert len(grey) == 1 and re.fullmatch(r"p[0-9a-f]{12}", grey[0])
    assert len(rows) == 5
    assert papers.run_topic(str(run)) == "agent communication protocols"
