"""GROBID: TEI parsing, optional behaviour, and (opt-in) the real native service.

The native install downloads about 1 GB and builds GROBID, so the integration test only runs when a service is
reachable: set CITEGEIST_TEST_GROBID=install (installs into the models dir), =auto (uses an installed copy), or
CITEGEIST_GROBID_URL=http://127.0.0.1:8070 (an existing service, for example Docker).
"""

from __future__ import annotations

import os

import pytest
from conftest import fixture_pdf
from helpers import assert_schema_valid

from citegeist_convert import convert, grobid

HEADER_TEI = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
<titleStmt><title level="a" type="main">Natural  Questions: A Benchmark</title></titleStmt>
<publicationStmt><date when="2019-08-01"/></publicationStmt>
<sourceDesc><biblStruct><analytic>
<author><persName><forename>Tom</forename> <surname>Kwiatkowski</surname></persName></author>
<author><persName><forename>Jennimaria</forename> <surname>Palomaki</surname></persName></author>
</analytic><idno type="DOI">10.1162/tacl_a_00276</idno></biblStruct></sourceDesc></fileDesc>
<profileDesc><abstract><p>We present a dataset.</p></abstract></profileDesc></teiHeader></TEI>"""

REFS_TEI = """<?xml version="1.0"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><back><div><listBibl>
<biblStruct xml:id="b0"><analytic><title level="a" type="main">Attention is all you need</title>
<author><persName><forename>A</forename><surname>Vaswani</surname></persName></author></analytic>
<monogr><title level="j">NeurIPS</title><imprint><date type="published" when="2017"/></imprint></monogr>
<idno type="DOI">10.5555/3295222.3295349</idno><note type="raw_reference">Vaswani A. Attention is all you need. NeurIPS 2017.</note></biblStruct>
<biblStruct xml:id="b1"><monogr><title level="m">The Book</title><imprint><date when="1999-01-01"/></imprint></monogr></biblStruct>
</listBibl></div></back></text></TEI>"""


def test_parse_header():
    h = grobid.parse_header(HEADER_TEI)
    assert h["title"] == "Natural Questions: A Benchmark"
    assert h["authors"] == ["Tom Kwiatkowski", "Jennimaria Palomaki"]
    assert h["doi"] == "10.1162/tacl_a_00276" and h["date"] == "2019-08-01" and h["abstract"] == "We present a dataset."


def test_parse_references():
    refs = grobid.parse_references(REFS_TEI)
    assert len(refs) == 2
    assert refs[0]["title"] == "Attention is all you need" and refs[0]["venue"] == "NeurIPS"
    assert refs[0]["year"] == "2017" and refs[0]["doi"] == "10.5555/3295222.3295349"
    assert refs[0]["raw"].startswith("Vaswani A.") and refs[0]["authors"] == ["A Vaswani"]
    assert refs[1]["title"] == "The Book" and refs[1]["year"] == "1999"


def test_worker_runs_without_grobid(monkeypatch, tmp_path):
    monkeypatch.setenv("CITEGEIST_GROBID", "off")
    monkeypatch.setenv("CITEGEIST_MODELS_DIR", str(tmp_path / "empty-models"))
    assert grobid.base_url() is None
    assert grobid.status() == "off"
    monkeypatch.setenv("CITEGEIST_GROBID", "auto")
    assert grobid.base_url() is None, "auto never installs by itself"
    assert grobid.status() in ("not installed", "unsupported platform")


def test_install_dir_is_machine_local_and_pinned(monkeypatch, tmp_path):
    monkeypatch.setenv("CITEGEIST_MODELS_DIR", str(tmp_path / "models"))
    assert grobid.install_dir() == tmp_path / "models" / "grobid" / grobid.VERSION
    for spec in (grobid.JRE, grobid.JDK, grobid.SOURCE):
        assert len(spec["sha256"]) == 64 and spec["url"].startswith("https://")
    assert grobid.VERSION in grobid.SOURCE["url"]


@pytest.mark.skipif(
    not (os.environ.get("CITEGEIST_GROBID_URL") or os.environ.get("CITEGEIST_TEST_GROBID", "off") != "off"),
    reason="opt-in: set CITEGEIST_TEST_GROBID=auto|install or CITEGEIST_GROBID_URL",
)
def test_grobid_service_end_to_end(models_ready, tmp_path):
    pdf = fixture_pdf("tacl-natural-questions-2019")
    out = tmp_path / "derived"
    m = convert.run(
        {
            "sourcePath": str(pdf),
            "source": "0123456789ab",
            "outDir": str(out),
            "kind": "pdf",
            "pageRangeHint": "453-466",
        }
    )
    assert "grobid-unavailable" not in m["flags"] and "grobid-failed" not in m["flags"], m["flags"]
    assert m["tools"]["grobid"] == grobid.VERSION
    o = assert_schema_valid(out)
    assert all(r["source"] == "grobid" for r in o["refs"]) and len(o["refs"]) >= 20
    header = (out / "header.json").read_text()
    assert "Natural Questions" in header
