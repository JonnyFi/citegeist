"""HTTP helper: global rate limit (~5 req/s), per-host spacing, 429/5xx backoff."""

import contextlib
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import settings  # noqa: F401  (data folders and CA bundle; every module that reads them imports net first)

MIN_INTERVAL = 0.2  # ~5 requests/second overall
HOST_INTERVAL = {
    "export.arxiv.org": 3.0,  # arXiv asks for one request every 3 seconds
    "api.semanticscholar.org": 1.1,  # unauthenticated shared pool
    "sparql.dblp.org": 1.0,  # DBLP asks for moderate use; queries are batched
    "api2.openreview.net": 2.0,  # rate-limited (HTTP 429 after a few quick searches)
    "api.openreview.net": 2.0,
    "pub.orcid.org": 0.2,  # public API: 24 requests/s, kept well below
    "api.unpaywall.org": 0.2,  # 100k requests/day
}
MAX_RETRIES = 6
MAX_RETRY_AFTER = 300  # a longer Retry-After means a daily quota is used up: fail instead of sleeping for hours

CONTACT_EMAIL = os.environ.get("OPENDRAFT_CONTACT_EMAIL", "").strip()
USER_AGENT = "research-pipeline/1.0" + (f" (mailto:{CONTACT_EMAIL})" if CONTACT_EMAIL else "")

_last_request = 0.0
_last_by_host = {}
_lock = threading.Lock()  # spacing stays global when lookups run in threads
# LibreSSL 2.8 (the python3 that ships with macOS) deadlocks when several threads use TLS at
# once, so requests run one at a time there
_tls = threading.Lock() if ssl.OPENSSL_VERSION.startswith("LibreSSL") else contextlib.nullcontext()
stats = {"requests": 0, "retries": 0}


def on_retry(msg):  # replaced by pipeline.py to emit progress events
    print(f"  [net] {msg}", file=sys.stderr)


class NotFound(Exception):
    pass


class RateLimited(Exception):
    pass


def rate_limit_message(host, seconds):
    hours = seconds / 3600
    when = f"in etwa {hours:.0f} h" if hours >= 1 else f"in etwa {seconds / 60:.0f} min"
    msg = f"Tageslimit von {host} erreicht, wieder frei {when}."
    if host == "api.openalex.org" and not os.environ.get("OPENALEX_API_KEY", "").strip():
        msg += (" Mit einem kostenlosen OpenAlex-API-Key ist das Limit viel höher:"
                " https://openalex.org/settings/api, dann in citegeist unter Einstellungen > Quellen eintragen.")
    return msg


def _wait(host):
    with _lock:
        _wait_locked(host)


def _wait_locked(host):
    global _last_request
    now = time.monotonic()
    delay = max(
        _last_request + MIN_INTERVAL - now,
        _last_by_host.get(host, 0.0) + HOST_INTERVAL.get(host, 0.0) - now,
    )
    if delay > 0:
        time.sleep(delay)
    _last_request = time.monotonic()
    _last_by_host[host] = _last_request


def with_mailto(params):
    """Add mailto for OpenAlex/Crossref polite pools when a contact email is set."""
    params = dict(params or {})
    if CONTACT_EMAIL:
        params["mailto"] = CONTACT_EMAIL
    return params


def fetch_bytes(url, max_bytes=60_000_000, timeout=60):
    """GET a binary file (e.g. a PDF), one attempt. Returns (bytes, content type, final URL).

    Raises on HTTP errors and on files larger than max_bytes.
    """
    host = urllib.parse.urlparse(url).netloc
    _wait(host)
    stats["requests"] += 1
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.8"})
    with _tls, urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError(f"file larger than {max_bytes // 1_000_000} MB")
        return data, resp.headers.get("Content-Type", ""), resp.geturl()


def fetch(url, params=None, data=None, headers=None, as_json=True, retries=MAX_RETRIES):
    """GET (or POST JSON if `data`), returning parsed JSON or text.

    Raises NotFound on 404; retries with exponential backoff on 429, 5xx
    and network errors; raises the last error when retries are exhausted.
    """
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    host = urllib.parse.urlparse(url).netloc
    body = json.dumps(data).encode() if data is not None else None
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json" if as_json else "*/*"}
    if body is not None:
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})

    backoff = 2.0
    for attempt in range(retries + 1):
        _wait(host)
        stats["requests"] += 1
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs)
            with _tls, urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if as_json else raw
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(re.sub(r"api_key=[^&]*", "api_key=***", url))
            if e.code != 429 and e.code < 500 or attempt == retries:
                raise
            retry_after = e.headers.get("Retry-After") if e.headers else None
            wait = float(retry_after) if retry_after and retry_after.isdigit() else backoff
            if wait > MAX_RETRY_AFTER:
                raise RateLimited(rate_limit_message(host, wait))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt == retries:
                raise
            wait = backoff
        stats["retries"] += 1
        on_retry(f"{host}: retry {attempt + 1}/{retries} in {wait:.0f}s")
        time.sleep(wait)
        backoff = min(backoff * 2, 60)
