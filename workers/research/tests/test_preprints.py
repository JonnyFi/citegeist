"""Preprint tracking: preprints of runs and imported reference lists, listed as JSON for the app."""

import importlib
import json
import os
import shutil
import subprocess
import sys

from conftest import FIXTURES, SCRIPTS


def test_list_json_collects_the_preprints_of_runs_and_imports(library_dir):
    # protects: the app's preprint tab sees every preprint of every run plus imported references, with their origins
    # fails_when: a run's preprint is missed, a peer-reviewed paper is tracked, or an import is not merged
    # no_claim: no network; the published check (OpenAlex, Crossref, DataCite) is not exercised
    runs = library_dir / "runs"
    runs.mkdir()
    shutil.copytree(os.path.join(FIXTURES, "run-sample"), runs / "run-sample")
    pp = importlib.import_module("preprints")
    bib = (
        "@article{x,\n  title={LLM Agents Talking: A Benchmark},\n  eprint={2601.01234},\n  archivePrefix={arXiv}\n}\n"
        "@article{y,\n  title={Another Preprint},\n  doi={10.48550/arXiv.2602.00001}\n}\n"
        "@article{z,\n  title={A Journal Paper},\n  doi={10.1145/3700001}\n}\n"
    )
    pp.import_text("refs.bib", bib)
    res = subprocess.run([sys.executable, os.path.join(SCRIPTS, "preprints.py"), "list", "--json"],
                         capture_output=True, text=True, env=os.environ.copy())
    assert res.returncode == 0, res.stderr
    out = json.loads(res.stdout)
    by_id = {it["id"]: it for it in out["items"]}
    assert set(by_id) == {"arxiv:2601.01234", "arxiv:2602.00001"}
    assert sorted(by_id["arxiv:2601.01234"]["origins"]) == ["import:refs.bib", "run:run-sample"]
    assert by_id["arxiv:2602.00001"]["status"] == "preprint"
    assert out["last_check"] is None


def _write_run(runs, name, arxiv):
    run = runs / name
    run.mkdir(parents=True)
    (run / "papers.csv").write_text(
        f"section,title,arxiv_id,year\npreprint,Paper {name},{arxiv},2026\n", encoding="utf-8")


def test_sync_rewrites_the_store_only_when_something_new_arrived(library_dir):
    # protects: litsearch.preprints (declared read) can call sync on every open without churning a synced file
    # fails_when: a second sync with unchanged runs writes preprints.json again, or a new run is not picked up
    # no_claim: the file lock is covered by the concurrent import test
    runs = library_dir / "runs"
    _write_run(runs, "r1", "2601.00001")
    pp = importlib.import_module("preprints")
    assert pp.sync_from_runs(str(runs)) == 1
    store = library_dir / "watches" / "preprints.json"
    first = store.stat()
    assert pp.sync_from_runs(str(runs)) == 0
    again = store.stat()
    assert (again.st_mtime_ns, again.st_ino) == (first.st_mtime_ns, first.st_ino)
    _write_run(runs, "r2", "2601.00002")
    assert pp.sync_from_runs(str(runs)) == 1
    assert sorted(json.loads(store.read_text())["items"]) == ["arxiv:2601.00001", "arxiv:2601.00002"]
    assert not list((library_dir / "watches").glob("*.tmp"))


def test_concurrent_imports_keep_every_preprint(library_dir, tmp_path):
    # protects: two scripts writing the store at once (an import and a sync, two Macs' agents) lose nothing
    # fails_when: a process overwrites the store with a copy it loaded before another one wrote
    # no_claim: the watch.py lock on watchlists.json is not exercised here
    files = []
    for i in range(6):
        f = tmp_path / f"refs{i}.bib"
        f.write_text(f"@article{{x{i},\n  title={{Preprint {i}}},\n  eprint={{2602.0000{i}}},\n  archivePrefix={{arXiv}}\n}}\n")
        files.append(f)
    procs = [subprocess.Popen([sys.executable, os.path.join(SCRIPTS, "preprints.py"), "import", str(f)],
                              env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.PIPE) for f in files]
    for p in procs:
        out, err = p.communicate(timeout=60)
        assert p.returncode == 0, err
    store = json.loads((library_dir / "watches" / "preprints.json").read_text())
    assert len(store["items"]) == 6
    assert len(store["imports"]) == 6
