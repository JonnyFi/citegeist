"""Literature search (citegeist): data folders, in one place.

citegeist starts these scripts and passes the folders through the environment:

  CITEGEIST_LITSEARCH_DIR     <library>/research: runs/, watches/ (preprint lists), opendraft and LaTeX output
  CITEGEIST_LITSEARCH_CACHE   machine-local lookup cache (DBLP, OpenReview, ORCID, h-index)
  OPENALEX_API_KEY            optional, from the citegeist settings
  OPENDRAFT_CONTACT_EMAIL     the citegeist "mailto" setting, sent to OpenAlex and Crossref

Without CITEGEIST_LITSEARCH_DIR the scripts refuse to run, so nothing lands outside a library.

Imported (through net) before every module that reads these values.
"""

import os
import sys

NAME = "citegeist literature search"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _required_dir():
    value = os.environ.get("CITEGEIST_LITSEARCH_DIR", "").strip()
    if not value:
        sys.exit("CITEGEIST_LITSEARCH_DIR is not set: citegeist passes <library>/research")
    return os.path.abspath(os.path.expanduser(value))


# Python builds without a CA bundle (python.org, some uv builds) fail every HTTPS request with
# CERTIFICATE_VERIFY_FAILED. macOS ships the system roots as /etc/ssl/cert.pem; OpenSSL reads
# SSL_CERT_FILE when urllib builds its default context.
if not os.environ.get("SSL_CERT_FILE") and os.path.isfile("/etc/ssl/cert.pem"):
    os.environ["SSL_CERT_FILE"] = "/etc/ssl/cert.pem"


DATA_DIR = _required_dir()
RUNS_DIR = os.path.join(DATA_DIR, "runs")
WATCH_DIR = os.path.join(DATA_DIR, "watches")
PROJECTS_DIR = os.path.join(DATA_DIR, "opendraft")  # opendraft projects handed over from a run
LATEX_DIR = os.path.join(DATA_DIR, "latex")  # Word -> LaTeX conversions
CACHE_DIR = os.path.abspath(os.path.expanduser(
    os.environ.get("CITEGEIST_LITSEARCH_CACHE", "").strip() or os.path.join(DATA_DIR, ".cache")))
# opendraft (paper writing): OPENDRAFT_DIR, else an installed skill, else the copy shipped in vendor/
OPENDRAFT_VENDOR = os.path.join(ROOT, "vendor", "opendraft")
OPENDRAFT_DIR = next((d for d in (os.path.expanduser(os.environ.get("OPENDRAFT_DIR") or ""),
                                  os.path.expanduser("~/.claude/skills/opendraft"))
                      if d and os.path.isfile(os.path.join(d, "scripts", "citations.py"))), OPENDRAFT_VENDOR)
