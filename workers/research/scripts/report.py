#!/usr/bin/env python3
"""One self-contained HTML report of a run, to send to others: how the search was done, the
charts, and every ranked paper with its link, score composition and summary.

    python3 report.py <run folder> [--out report.html]

Reads run.json, papers.csv and papers.md of the run (nothing is fetched again), writes
<run folder>/report.html by default. No scripts, no external files: the charts are inline SVG,
the styles are in the file, so it opens offline, in any browser, and prints to PDF.
"""

import argparse
import csv
import datetime
import html
import json
import math
import os
import re

W_LABELS = [("score_relevance", "Relevanz", "#e87ba4"), ("score_venue", "Venue", "#008300"),
            ("score_author", "Autoren", "#4a3aa7"), ("score_citations", "Zitate", "#e34948")]
TIER = {"1": ("Tier 1", "#2a78d6"), "2": ("Tier 2", "#eb6834"), "": ("Nicht gelistet", "#1baf7a")}
SECTIONS = [("main", "Begutachtete Paper"), ("preprint", "Preprints (nicht begutachtet)"),
            ("grey", "Graue Literatur (nur Zenodo, OSF, Figshare)")]
GRID, AXIS, INK2 = "#e1e0d9", "#c3c2b7", "#52514e"

CSS = """
:root { --ink:#0b0b0b; --ink-2:#52514e; --muted:#6b6a65; --grid:#e1e0d9; --surface:#fcfcfb; --surface-2:#f2f1ed; --accent:#1f6bc4; }
* { box-sizing: border-box; }
body { margin: 0; background: #f5f5f2; color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 40px 32px 64px; }
h1 { font-size: 26px; line-height: 1.25; margin: 0 0 6px; }
h2 { font-size: 19px; margin: 40px 0 12px; }
h3 { font-size: 15px; margin: 22px 0 8px; }
a { color: var(--accent); }
.sub { color: var(--ink-2); margin: 0 0 24px; }
.card { background: var(--surface); border: 1px solid rgba(11,11,11,.08); border-radius: 14px; padding: 18px 22px; margin: 0 0 16px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
.kpi { background: var(--surface); border: 1px solid rgba(11,11,11,.08); border-radius: 14px; padding: 14px 18px; }
.kpi b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--ink-2); font-size: 13px; }
.funnel { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--ink-2); font-size: 13px; margin-top: 12px; }
.funnel b { color: var(--ink); font-variant-numeric: tabular-nums; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.charts .wide { grid-column: span 2; }
.charts h3 { margin: 0 0 10px; }
.note { color: var(--muted); font-size: 12.5px; margin: 8px 0 0; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--ink-2); margin: 0 0 8px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
svg text { font-family: inherit; }
ol.q { margin: 0; padding-left: 22px; } ol.q code { font-size: 13px; }
dl.m { display: grid; grid-template-columns: 210px 1fr; gap: 8px 18px; margin: 0; }
dl.m dt { color: var(--muted); } dl.m dd { margin: 0; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 14px; overflow: hidden; border: 1px solid rgba(11,11,11,.08); }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-top: 1px solid var(--grid); }
th { background: var(--surface-2); font-size: 12px; color: var(--ink-2); font-weight: 600; border-top: 0; white-space: nowrap; }
td.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td .t { font-weight: 600; }
td .meta { color: var(--ink-2); font-size: 12.5px; margin-top: 2px; }
td .why { color: var(--ink-2); font-size: 12.5px; }
td details { margin-top: 6px; font-size: 13px; } td summary { cursor: pointer; color: var(--accent); width: fit-content; }
td details p { margin: 6px 0 0; }
.pill { display: inline-block; font-size: 11.5px; padding: 1px 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px #c3c2b7; color: var(--ink-2); white-space: nowrap; }
.chip { display: inline-block; min-width: 44px; text-align: center; border-radius: 999px; padding: 1px 8px; font-weight: 650; background: var(--surface-2); }
ul.plain { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
footer { color: var(--muted); font-size: 12.5px; margin-top: 48px; border-top: 1px solid var(--grid); padding-top: 16px; }
@media (max-width: 800px) { .kpis { grid-template-columns: repeat(2, minmax(0,1fr)); } .charts { grid-template-columns: 1fr; } .charts .wide { grid-column: auto; } dl.m { grid-template-columns: 1fr; } }
@media print {
  body { background: #fff; font-size: 11px; } main { max-width: none; padding: 0; }
  .card, .kpi, table { border-color: #ddd; } h2 { break-after: avoid; } tr, .card { break-inside: avoid; }
  td details { display: block; } td details > summary { display: none; } td details:not([open]) > p { display: block; }
  a { color: inherit; text-decoration: none; }
}
"""


def esc(s):
    return html.escape(str(s or ""), quote=True)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def de(v, d=0):
    s = f"{v:,.{d}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def md_inline(text):
    """The bits of Markdown that papers.md uses in its notes: links, bold, code."""
    out = esc(text)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    return re.sub(r"(?<![\"=>])\b(10\.\d{4,9}/[^\s<,;)]+)", r'<a href="https://doi.org/\1">\1</a>', out)


def md_sections(text):
    """{heading: [bullet or numbered item]} for the sections of papers.md."""
    out, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^## (.+?)\s*$", line)
        if m:
            cur = re.sub(r"\s*\(\d+\)$", "", m.group(1))
            out[cur] = []
        elif cur and re.match(r"^(- |\d+\. )", line):
            out[cur].append(re.sub(r"^(- |\d+\. )", "", line).strip())
    return out


# --- charts (inline SVG) -------------------------------------------------------------------------

def svg(w, h, body, label):
    return f'<svg viewBox="0 0 {w} {h}" width="100%" role="img" aria-label="{esc(label)}" xmlns="http://www.w3.org/2000/svg">{body}</svg>'


def chart_years(rows):
    main = [r for r in rows if r["section"] == "main"]
    pre = [r for r in rows if r["section"] == "preprint"]
    years = sorted({int(r["year"]) for r in main + pre if (r["year"] or "").isdigit()})
    if not years:
        return "<p class='note'>Keine Jahresangaben.</p>"
    years = list(range(years[0], years[-1] + 1))
    cm = {y: sum(1 for r in main if r["year"] == str(y)) for y in years}
    cp = {y: sum(1 for r in pre if r["year"] == str(y)) for y in years}
    top = max(cm[y] + cp[y] for y in years) or 1
    W, H, L, B = 520, 220, 28, 26
    bw = (W - L - 6) / len(years)
    body = ""
    step = max(1, math.ceil(top / 4))
    for v in range(0, top + 1, step):
        y = H - B - (H - B - 10) * v / top
        body += f'<line x1="{L}" x2="{W}" y1="{y:.1f}" y2="{y:.1f}" stroke="{GRID}"/><text x="{L - 6}" y="{y + 4:.1f}" font-size="10" text-anchor="end" fill="{INK2}">{v}</text>'
    for i, yr in enumerate(years):
        x = L + i * bw + 1
        hm = (H - B - 10) * cm[yr] / top
        hp = (H - B - 10) * cp[yr] / top
        body += f'<rect x="{x:.1f}" y="{H - B - hm:.1f}" width="{max(bw - 2, 1):.1f}" height="{hm:.1f}" fill="#2a78d6" rx="2"><title>{yr}: {cm[yr]} begutachtet</title></rect>'
        if hp:
            body += f'<rect x="{x:.1f}" y="{H - B - hm - hp:.1f}" width="{max(bw - 2, 1):.1f}" height="{hp:.1f}" fill="#b9cdea" rx="2"><title>{yr}: {cp[yr]} Preprints</title></rect>'
        every = max(1, math.ceil(len(years) / 10))
        if i % every == 0:
            body += f'<text x="{x + bw / 2:.1f}" y="{H - 8}" font-size="10" text-anchor="middle" fill="{INK2}">{yr}</text>'
    legend = '<div class="legend"><span><span class="sw" style="background:#2a78d6"></span>Begutachtet</span><span><span class="sw" style="background:#b9cdea"></span>Preprints</span></div>'
    return legend + svg(W, H, body, "Paper pro Jahr")


def chart_tiers(rows):
    main = [r for r in rows if r["section"] == "main"]
    counts = [(TIER[k][0], TIER[k][1], sum(1 for r in main if (r["venue_tier"] or "") == k)) for k in ("1", "2", "")]
    top = max(c for _, _, c in counts) or 1
    W, H, L = 520, 130, 110
    body = ""
    for i, (label, color, c) in enumerate(counts):
        y = 12 + i * 38
        w = (W - L - 110) * c / top
        body += (f'<text x="{L - 10}" y="{y + 17}" font-size="12" text-anchor="end" fill="{INK2}">{label}</text>'
                 f'<rect x="{L}" y="{y}" width="{max(w, 1):.1f}" height="24" rx="4" fill="{color}"/>'
                 f'<text x="{L + w + 8:.1f}" y="{y + 17}" font-size="12" fill="#0b0b0b">{c} ({de(100 * c / max(len(main), 1))} %)</text>')
    return svg(W, H, body, "Verteilung nach Venue-Tier")


def chart_composition(rows):
    main = sorted([r for r in rows if r["section"] == "main"], key=lambda r: -(num(r["score"]) or 0))
    if not main:
        return ""
    W, row, L = 1080, 17, 34
    H = 24 + row * len(main)
    scale = (W - L - 50) / 100
    body = ""
    for v in range(0, 101, 20):
        x = L + v * scale
        body += f'<line x1="{x:.1f}" x2="{x:.1f}" y1="14" y2="{H}" stroke="{GRID}"/><text x="{x:.1f}" y="10" font-size="10" text-anchor="middle" fill="{INK2}">{v}</text>'
    for i, r in enumerate(main):
        y, x = 18 + i * row, L
        body += f'<text x="{L - 6}" y="{y + 11}" font-size="10" text-anchor="end" fill="{INK2}">{esc(r["rank"])}</text>'
        for key, label, color in W_LABELS:
            v = num(r[key]) or 0
            body += f'<rect x="{x:.1f}" y="{y}" width="{v * scale:.1f}" height="{row - 4}" fill="{color}"><title>#{esc(r["rank"])} {esc(r["title"])} – {label}: {de(v, 1)}</title></rect>'
            x += v * scale
        body += f'<text x="{x + 6:.1f}" y="{y + 11}" font-size="10" fill="#0b0b0b">{de(num(r["score"]) or 0, 1)}</text>'
    legend = '<div class="legend">' + "".join(f'<span><span class="sw" style="background:{c}"></span>{label}</span>' for _, label, c in W_LABELS) + "</div>"
    return legend + svg(W, H, body, "Zusammensetzung des Scores")


def chart_scatter(rows):
    pts = [(int(r["year"]), num(r["citations_per_year"]) or 0, r) for r in rows
           if r["section"] == "main" and (r["year"] or "").isdigit()]
    if not pts:
        return ""
    y0, y1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y1 = max(y1, y0 + 1)
    cmax = max(p[1] for p in pts) or 1
    W, H, L, B = 1080, 270, 44, 26
    ly = lambda c: H - B - (H - B - 16) * math.log10(1 + c) / math.log10(1 + cmax)  # noqa: E731
    lx = lambda y: L + (W - L - 20) * (y - y0) / (y1 - y0)  # noqa: E731
    body = ""
    for v in [0, 1, 3, 10, 30, 100, 300, 1000, 3000]:
        if v > cmax and v > 1:
            break
        y = ly(v)
        body += f'<line x1="{L}" x2="{W}" y1="{y:.1f}" y2="{y:.1f}" stroke="{GRID}"/><text x="{L - 6}" y="{y + 4:.1f}" font-size="10" text-anchor="end" fill="{INK2}">{v}</text>'
    for yr in range(y0, y1 + 1, max(1, math.ceil((y1 - y0) / 12))):
        body += f'<text x="{lx(yr):.1f}" y="{H - 8}" font-size="10" text-anchor="middle" fill="{INK2}">{yr}</text>'
    for yr, c, r in pts:
        jitter = (int(r["rank"] or 0) * 7 % 11 - 5) * 0.06
        color = TIER.get(r["venue_tier"] or "", TIER[""])[1]
        body += (f'<circle cx="{lx(yr + jitter):.1f}" cy="{ly(c):.1f}" r="5" fill="{color}" fill-opacity=".8" stroke="#fff">'
                 f'<title>#{esc(r["rank"])} {esc(r["title"])} ({yr}) – {de(c, 1)} Zitate/Jahr</title></circle>')
    legend = '<div class="legend">' + "".join(f'<span><span class="sw" style="background:{TIER[k][1]}"></span>{TIER[k][0]}</span>' for k in ("1", "2", "")) + "</div>"
    return legend + svg(W, H, body, "Erscheinungsjahr und Zitate pro Jahr")


# --- tables ---------------------------------------------------------------------------------------

def score_bar(r):
    x, parts = 0, ""
    for key, label, color in W_LABELS:
        v = num(r[key]) or 0
        parts += f'<rect x="{x:.1f}" y="0" width="{v * 0.9:.1f}" height="6" fill="{color}"><title>{label}: {de(v, 1)}</title></rect>'
        x += v * 0.9
    return f'<svg viewBox="0 0 90 6" width="90" height="6" style="display:block;margin-top:5px">{parts}</svg>'


def short_authors(a, n=3):
    names = [x.strip() for x in (a or "").split(";") if x.strip()]
    return ", ".join(names[:n]) + (" et al." if len(names) > n else "")


def paper_rows(rows):
    out = []
    for r in rows:
        link = r["link"] or (f"https://doi.org/{r['verified_doi']}" if r["verified_doi"] else "")
        if not re.match(r"https?://", link, re.I):  # javascript: and data: links from a CSV cell are not rendered
            link = ""
        title = f'<a class="t" href="{esc(link)}">{esc(r["title"])}</a>' if link else f'<span class="t">{esc(r["title"])}</span>'
        tier = TIER.get(r["venue_tier"] or "", TIER[""])[0]
        badges = []
        if (r["found_via"] or "").startswith("snowball"):
            badges.append('<span class="pill">über Schneeballsuche</span>')
        if r.get("openreview_status"):
            badges.append(f'<span class="pill">OpenReview: {esc(r["openreview_status"])}</span>')
        doi = r["verified_doi"]
        details = []
        if r["summary"]:
            details.append(f"<p><b>Zusammenfassung:</b> {esc(r['summary'])}</p>")
        if r.get("venue_note"):
            details.append(f"<p><b>Venue:</b> {esc(r['venue_note'])}</p>")
        details.append("<p><b>Score:</b> " + " · ".join(f"{label} {de(num(r[k]) or 0, 1)}" for k, label, _ in W_LABELS)
                       + f" = {de(num(r['score']) or 0, 1)}</p>")
        if doi:
            details.append(f'<p><b>DOI:</b> <a href="https://doi.org/{esc(doi)}">{esc(doi)}</a> (geprüft bei {esc(r["verified_by"])})</p>')
        if r.get("queries"):
            details.append(f"<p><b>Gefunden über:</b> {esc(r['queries'])}</p>")
        cy, h = num(r["citations_per_year"]), num(r["max_h_index"])
        out.append(
            f'<tr><td class="n">{esc(r["rank"])}</td>'
            f'<td class="n"><span class="chip">{de(num(r["score"]) or 0, 1)}</span>{score_bar(r)}</td>'
            f'<td>{title} {" ".join(badges)}<div class="meta">{esc(short_authors(r["authors"]))} · {esc(r["year"])} · {esc(r["venue"]) or "Venue unbekannt"}</div>'
            f'<div class="why">{esc(r["why_selected"])}</div><details><summary>Details</summary>{"".join(details)}</details></td>'
            f'<td style="white-space:nowrap">{tier}</td><td class="n">{de(cy, 1) if cy is not None else "–"}</td><td class="n">{de(h) if h is not None else "–"}</td></tr>')
    return ('<table><thead><tr><th>#</th><th>Score</th><th>Paper</th><th>Venue-Tier</th><th>Zit./Jahr</th><th>max. h</th></tr></thead><tbody>'
            + "".join(out) + "</tbody></table>")


# --- the report -------------------------------------------------------------------------------------

def build(run_dir):
    with open(os.path.join(run_dir, "papers.csv"), encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    meta = {}
    if os.path.exists(os.path.join(run_dir, "run.json")):
        with open(os.path.join(run_dir, "run.json"), encoding="utf-8") as f:
            meta = json.load(f)
    md = ""
    if os.path.exists(os.path.join(run_dir, "papers.md")):
        with open(os.path.join(run_dir, "papers.md"), encoding="utf-8") as f:
            md = f.read()
    secs = md_sections(md)
    topic = meta.get("topic") or (re.search(r"^# Research Pipeline: (.+)$", md, re.M) or [None, os.path.basename(run_dir)])[1]
    queries = meta.get("queries") or secs.get("Search queries used", [])
    if isinstance(queries, str):
        queries = [queries]
    stats = re.search(r"(\d+) records retrieved, (\d+) after dedup, (\d+) failed the relevance gate, (\d+) candidates ranked", md)
    weights = re.search(r"relevance/venue/author/citations = ([\d/]+)", md)
    snow = re.search(r"^Snowballing: (.+)$", md, re.M)
    by = {s: [r for r in rows if r["section"] == s] for s in ("main", "preprint", "grey", "rejected")}
    created = (meta.get("created") or "")[:16].replace("T", " ")
    finished = meta.get("finished") or ""
    dur = ""
    if meta.get("created") and finished:
        try:
            secs_ = (datetime.datetime.fromisoformat(finished) - datetime.datetime.fromisoformat(meta["created"])).total_seconds()
            dur = f", Laufzeit {int(secs_ // 60)} min"
        except ValueError:
            pass
    w = (weights.group(1).split("/") if weights else ["30", "30", "20", "20"])

    p = []
    p.append(f"<h1>Literaturrecherche: {esc(topic)}</h1>")
    p.append(f'<p class="sub">Suche vom {esc(created)}{dur} · erstellt mit der Literatursuche von citegeist · '
             f'alle Angaben stammen aus den Antworten von OpenAlex, arXiv, Semantic Scholar, Crossref und DataCite</p>')
    p.append('<div class="kpis">'
             f'<div class="kpi"><b>{len(by["main"])}</b><span>begutachtete Paper</span></div>'
             f'<div class="kpi"><b>{len(by["preprint"])}</b><span>Preprints</span></div>'
             f'<div class="kpi"><b>{len(by["grey"])}</b><span>Graue Literatur</span></div>'
             f'<div class="kpi"><b>{len(by["rejected"])}</b><span>abgelehnt (DOI nicht prüfbar)</span></div></div>')
    if stats:
        a, b, c, d = (de(int(x)) for x in stats.groups())
        p.append(f'<div class="funnel"><b>{a}</b> Treffer abgerufen → <b>{b}</b> nach Duplikatentfernung → '
                 f'<b>{c}</b> ohne die Suchbegriffe in Titel/Abstract ausgeschieden → <b>{d}</b> Kandidaten bewertet → '
                 f'<b>{len(by["main"])}</b> begutachtete Paper in der Rangliste</div>')

    p.append("<h2>Vorgehen</h2><div class='card'><dl class='m'>")
    p.append("<dt>Datenbanken</dt><dd>OpenAlex (Titel und Abstract), arXiv; ergänzt um Semantic Scholar (Zitationsdaten), "
             "DBLP (Venue und Track), ORCID (Autorenprofile) und OpenReview (Begutachtungsstatus)</dd>")
    p.append("<dt>Suchanfragen</dt><dd><ol class='q'>" + "".join(f"<li><code>{esc(q)}</code></li>" for q in queries) + "</ol></dd>")
    since = meta.get("since")
    p.append(f"<dt>Zeitraum</dt><dd>{'ab ' + esc(since) if since else 'keine Einschränkung'}</dd>")
    p.append("<dt>Relevanzfilter</dt><dd>Ein Paper bleibt nur, wenn Titel oder Abstract jede Phrase in Anführungszeichen und jedes "
             "weitere Wort mindestens einer Suchanfrage enthalten (leichte Wortstamm-Erkennung).</dd>")
    p.append(f"<dt>Bewertung (0–100)</dt><dd>Relevanz {w[0]} · Venue-Tier {w[1]} · Autoren (max. h-Index) {w[2]} · Zitationswirkung {w[3]} Punkte. "
             "Relevanz = Rang in den OpenAlex-Ergebnissen der besten Anfrage; Venue-Tier aus einer festen Liste "
             "(Tier 1 = volle Punkte, Tier 2 = 60 %, nicht gelistet = 20 %); Zitationswirkung = FWCI, sonst Zitate pro Jahr (logarithmisch).</dd>")
    if snow:
        seeds = secs.get("Snowballing seeds", [])
        p.append("<dt>Schneeballsuche</dt><dd>" + esc(snow.group(1).replace("references and citing works of", "Literaturverzeichnisse und zitierende Arbeiten von")
                                                    .replace("seed papers added", "Ausgangspapern ergaben").replace("new candidates", "neue Kandidaten")
                                                    .replace("marked “found via snowballing”; relevance fixed at 50", "markiert, Relevanz fest 50"))
                 + ("<details style='margin-top:6px'><summary>Ausgangspaper</summary><ol class='q'>" + "".join(f"<li>{md_inline(s)}</li>" for s in seeds) + "</ol></details>" if seeds else "")
                 + "</dd>")
    p.append("<dt>Prüfung</dt><dd>Jede DOI wurde bei Crossref bzw. DataCite aufgelöst; Paper ohne prüfbare DOI sind unten als abgelehnt aufgeführt. "
             "Preprints und Graue Literatur werden getrennt gerankt.</dd>")
    p.append("</dl></div>")

    p.append("<h2>Überblick</h2><div class='charts'>")
    p.append(f"<div class='card'><h3>Paper pro Jahr</h3>{chart_years(rows)}</div>")
    p.append(f"<div class='card'><h3>Begutachtete Paper nach Venue-Tier</h3>{chart_tiers(rows)}<p class='note'>Tier laut der Venue-Liste der Pipeline (venues.yaml).</p></div>")
    p.append(f"<div class='card wide'><h3>Zusammensetzung des Scores (Rang 1–{len(by['main'])})</h3>{chart_composition(rows)}</div>")
    p.append(f"<div class='card wide'><h3>Erscheinungsjahr und Zitate pro Jahr</h3>{chart_scatter(rows)}<p class='note'>Begutachtete Paper; Zitate pro Jahr logarithmisch. Mit der Maus auf einen Punkt zeigen für den Titel.</p></div>")
    p.append("</div>")

    for key, label in SECTIONS:
        if by[key]:
            p.append(f"<h2>{label} ({len(by[key])})</h2>")
            if key == "preprint":
                p.append("<p class='sub'>Nicht begutachtet; eigener Rang.</p>")
            p.append(paper_rows(by[key]))
    if by["rejected"]:
        p.append(f"<h2>Abgelehnt ({len(by['rejected'])})</h2><div class='card'><ul class='plain'>"
                 + "".join(f"<li>{esc(r['title'])} ({esc(r['year'])}) – {esc(r['rejected_reason'])}</li>" for r in by["rejected"]) + "</ul></div>")
    notes = [(h, items) for h, items in secs.items() if h.startswith(("Venue notes", "Author h-index")) and items]
    if notes:
        titles = {"Venue notes from DBLP": "Venue-Hinweise aus DBLP", "Author h-index from merged profiles (ORCID)": "Zusammengeführte Autorenprofile (ORCID)"}
        p.append("<h2>Anmerkungen</h2>")
        for h, items in notes:
            p.append(f"<h3>{esc(titles.get(h, h))}</h3><div class='card'><ul class='plain'>" + "".join(f"<li>{md_inline(i)}</li>" for i in items) + "</ul></div>")
    p.append(f"<footer>Erstellt am {datetime.datetime.now().strftime('%d.%m.%Y %H:%M')} aus dem Lauf <code>{esc(os.path.basename(run_dir))}</code>. "
             "Die vollständigen Daten (alle Felder, BibTeX) liegen als papers.csv und references.bib beim Lauf.</footer>")
    return (f'<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f"<title>Literaturrecherche: {esc(topic)}</title><style>{CSS}</style></head><body><main>{''.join(p)}</main></body></html>")


def write(run_dir, out=None):
    out = out or os.path.join(run_dir, "report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build(run_dir))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", help="run folder (with papers.csv)")
    ap.add_argument("--out", help="output file (default: <run>/report.html)")
    args = ap.parse_args()
    print(write(os.path.abspath(args.run), args.out))


if __name__ == "__main__":
    main()
