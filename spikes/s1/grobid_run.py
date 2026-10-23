"""GROBID header + reference extraction for all fixtures with a text layer.

Needs the container:  docker run --rm -d --name grobid-s1 -p 8070:8070 --init lfoppiano/grobid:0.9.1-crf
usage: uv run python grobid_run.py [id ...]
"""
import difflib
import json
import sys
import time

import pypdf
import requests
from lxml import etree

from common import is_scan, norm, out_dir, pdf_path, select

BASE = "http://localhost:8070/api"
NS = {"t": "http://www.tei-c.org/ns/1.0"}


def post(endpoint, path, **data):
    t0 = time.perf_counter()
    with open(path, "rb") as f:
        r = requests.post(f"{BASE}/{endpoint}", files={"input": f}, data=data, headers={"Accept": "application/xml"}, timeout=600)
    return r.status_code, r.text, time.perf_counter() - t0


def parse_header(xml):
    root = etree.fromstring(xml.encode())
    title = " ".join("".join(root.xpath("//t:fileDesc/t:titleStmt/t:title//text()", namespaces=NS)).split())
    authors = []
    for p in root.xpath("//t:fileDesc/t:sourceDesc/t:biblStruct/t:analytic/t:author/t:persName", namespaces=NS):
        authors.append(" ".join(" ".join(p.xpath(".//text()")).split()))
    doi = root.xpath("string(//t:sourceDesc//t:idno[@type='DOI'])", namespaces=NS).strip() or None
    date = root.xpath("string(//t:publicationStmt/t:date/@when)", namespaces=NS) or root.xpath("string(//t:monogr/t:imprint/t:date/@when)", namespaces=NS) or None
    abstract = " ".join("".join(root.xpath("//t:profileDesc/t:abstract//text()", namespaces=NS)).split())
    return {"title": title, "authors": authors, "doi": doi, "date": date or None, "abstract_chars": len(abstract)}


def parse_refs(xml):
    root = etree.fromstring(xml.encode())
    refs = []
    for b in root.xpath("//t:listBibl/t:biblStruct", namespaces=NS):
        title = " ".join("".join(b.xpath("string(t:analytic/t:title)", namespaces=NS) or b.xpath("string(t:monogr/t:title)", namespaces=NS)).split())
        doi = b.xpath("string(.//t:idno[@type='DOI'])", namespaces=NS).strip() or None
        year = (b.xpath("string(.//t:imprint/t:date/@when)", namespaces=NS) or "")[:4] or None
        authors = [" ".join(" ".join(p.xpath(".//text()")).split()) for p in b.xpath("t:analytic/t:author/t:persName | t:monogr/t:author/t:persName", namespaces=NS)]
        refs.append({"title": title, "doi": doi, "year": year, "n_authors": len(authors)})
    return refs


def main():
    summary = []
    for fx in select(sys.argv[1:]):
        if is_scan(fx):
            print(f"{fx['id']:40s} skipped (no text layer; ocrmac output is not a PDF)")
            continue
        od = out_dir(fx) / "grobid"
        od.mkdir(exist_ok=True)
        path = pdf_path(fx)
        n = len(pypdf.PdfReader(path).pages)
        sc, hxml, th = post("processHeaderDocument", path, consolidateHeader="0")
        (od / "header.tei.xml").write_text(hxml)
        sc2, rxml, tr = post("processReferences", path, consolidateCitations="0")
        (od / "references.tei.xml").write_text(rxml)
        rec = {"id": fx["id"], "pages": n, "header_status": sc, "refs_status": sc2, "header_s": round(th, 2), "refs_s": round(tr, 2)}
        if sc == 200:
            h = parse_header(hxml)
            rec["header"] = h
            rec["title_similarity"] = round(difflib.SequenceMatcher(None, norm(h["title"]), norm(fx["title"])).ratio(), 2)
        if sc2 == 200:
            refs = parse_refs(rxml)
            ok = [r for r in refs if r["doi"] or (r["title"] and r["year"])]
            rec["refs"] = {"count": len(refs), "with_doi_or_title_year": len(ok), "with_doi": sum(1 for r in refs if r["doi"])}
            (od / "references.json").write_text(json.dumps(refs, indent=1, ensure_ascii=False))
        summary.append(rec)
        print(json.dumps(rec, ensure_ascii=False)[:400], flush=True)
    (out_dir({"id": "_summary"}) / "grobid_summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
