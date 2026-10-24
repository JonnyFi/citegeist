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
