"""Venue matching and 0-100 scoring."""

import datetime
import math
import re

ORDINAL_WORDS = (
    "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth "
    "thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth "
    "thirtieth fortieth fiftieth sixtieth twenty thirty forty fifty sixty"
).split()
FIELD_LABELS = {"ai_ml": "AI/ML", "is_business": "IS/Business", "ethics_governance": "Ethics/Governance"}


def normalize_venue(name):
    """Normalise a venue name to its comparison key (returned as a 0/1-element list)."""
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^\w\s]", " ", s.replace("_", " "))
    s = re.sub(r"\b(19|20)\d{2}\b", " ", s)
    s = re.sub(r"\b\d+(st|nd|rd|th)?\b", " ", s)  # ordinals and volume numbers
    s = re.sub(r"\b(" + "|".join(ORDINAL_WORDS) + r"|proceedings|annual)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^((of|the|in)\s+)+", "", s)
    return [s] if s else []


class VenueIndex:
    def __init__(self, venues_cfg):
        self.index = {}
        for field, tiers in (venues_cfg or {}).items():
            for tier_key, venues in (tiers or {}).items():
                tier = int(str(tier_key).replace("tier", ""))
                for canonical, aliases in (venues or {}).items():
                    for alias in [canonical] + list(aliases or []):
                        for key in normalize_venue(str(alias)):
                            # keep the better tier if a name appears twice
                            if key not in self.index or self.index[key][1] > tier:
                                self.index[key] = (str(canonical), tier, field)

    def match(self, venue_name):
        """Return (canonical, tier, field) or None."""
        for key in normalize_venue(venue_name):
            if key in self.index:
                return self.index[key]
        return None


def _log_scaled(value, cap):
    if value is None or value <= 0:
        return 0.0
    return 100.0 * math.log1p(min(value, cap)) / math.log1p(cap)


def score_paper(p, cfg, listed_institutions):
    sc = cfg["scoring"]
    tier_scores = {1: sc["tier1_score"], 2: sc["tier2_score"]}
    venue = tier_scores.get(p.get("venue_tier"), sc["unlisted_score"])

    author = _log_scaled(p.get("max_h_index"), sc["h_index_cap"])
    matched = sorted({i for i in p.get("institutions", []) if i.lower() in listed_institutions})
    p["listed_institutions"] = matched
    if matched:
        author = min(100.0, author + sc["institution_bonus"])

    year = p.get("year")
    years = max(1, datetime.date.today().year - year) if year else None
    p["citations_per_year"] = (
        round(p["cited_by_count"] / years, 1) if years and p.get("cited_by_count") is not None else None
    )
    if p.get("fwci") is not None:
        citations = _log_scaled(p["fwci"], sc["fwci_cap"])
        p["citation_signal"] = "fwci"
    else:
        citations = _log_scaled(p.get("citations_per_year"), sc["citations_per_year_cap"])
        p["citation_signal"] = "citations_per_year" if p.get("citations_per_year") is not None else ""

    w = cfg["weights"]
    total_w = w["relevance"] + w["venue"] + w["author"] + w["citations"]
    parts = {
        "relevance": (p.get("relevance") or 0) * w["relevance"] / total_w,
        "venue": venue * w["venue"] / total_w,
        "author": author * w["author"] / total_w,
        "citations": citations * w["citations"] / total_w,
    }
    p["score_relevance"], p["score_venue"], p["score_author"], p["score_citations"] = (
        round(v, 1) for v in parts.values())
    p["score"] = round(sum(parts.values()), 1)
    p["why_selected"] = _why(p, parts, w, total_w)


def _why(p, parts, w, total_w):
    def describe(k):
        pts = f"{parts[k]:.0f}/{100 * w[k] / total_w:.0f}"
        if k == "relevance":
            return f"relevance {p['relevance_note']} {pts}"
        if k == "venue":
            if p.get("venue_tier"):
                return f"tier-{p['venue_tier']} venue ({p['venue_canonical']}) {pts}"
            return f"unlisted venue {pts}"
        if k == "author":
            if p.get("max_h_index") is None:
                return f"no author h-index data {pts}"
            src = " (S2)" if p.get("max_h_source") == "Semantic Scholar" else ""
            s = f"max author h-index {p['max_h_index']}{src}"
            if p.get("listed_institutions"):
                s += f" + listed institution ({p['listed_institutions'][0]})"
            return f"{s} {pts}"
        if p.get("citation_signal") == "fwci":
            return f"FWCI {p['fwci']:.2f} {pts}"
        if p.get("citation_signal"):
            return f"{p['citations_per_year']} citations/yr {pts}"
        return f"no citation data {pts}"

    ranked = sorted(parts, key=lambda k: parts[k], reverse=True)
    return "; ".join(describe(k) for k in ranked[:2])
