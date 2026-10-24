"""report.py: the self-contained HTML report of a run."""

import os
import shutil
import subprocess
import sys

from conftest import FIXTURES, SCRIPTS


def test_links_of_other_schemes_are_not_rendered_as_links(tmp_path):
    # protects: a report that is sent to others never carries a javascript: or data: link from a CSV cell
    # fails_when: the link column of papers.csv reaches an href with a scheme other than http or https
    # no_claim: the escaping of the link text and the DOI links are not checked here
    run = tmp_path / "run"
    shutil.copytree(os.path.join(FIXTURES, "run-sample"), run)
    csv_path = run / "papers.csv"
    text = csv_path.read_text(encoding="utf-8")
    assert "https://doi.org/10.1145/3700001" in text
    csv_path.write_text(text.replace("https://doi.org/10.1145/3700001", "javascript:alert(1)"), encoding="utf-8")
    out = tmp_path / "report.html"
    res = subprocess.run([sys.executable, os.path.join(SCRIPTS, "report.py"), str(run), "--out", str(out)],
                         capture_output=True, text=True, env=os.environ.copy())
    assert res.returncode == 0, res.stderr
    html = out.read_text(encoding="utf-8")
    assert "javascript:" not in html
    assert 'href="https://doi.org/' in html  # other papers keep their links
