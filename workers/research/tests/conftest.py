import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
FIXTURES = os.path.join(ROOT, "tests", "fixtures")


@pytest.fixture(autouse=True)
def library_dir(tmp_path, monkeypatch):
    """Every test runs against its own <library>/research folder; settings.py refuses to run without one."""
    data = tmp_path / "research"
    data.mkdir()
    monkeypatch.setenv("CITEGEIST_LITSEARCH_DIR", str(data))
    monkeypatch.setenv("CITEGEIST_LITSEARCH_CACHE", str(tmp_path / "cache"))
    monkeypatch.syspath_prepend(SCRIPTS)
    for name in [m for m in sys.modules if m in SCRIPT_MODULES]:
        del sys.modules[name]  # settings reads the environment at import time
    return data


SCRIPT_MODULES = {os.path.splitext(f)[0] for f in os.listdir(SCRIPTS) if f.endswith(".py")}
