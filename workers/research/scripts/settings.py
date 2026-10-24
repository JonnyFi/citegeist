"""Literature search (citegeist): data folders, in one place.

citegeist starts these scripts and passes the folders through the environment:

  CITEGEIST_LITSEARCH_DIR     <library>/research: runs/, watches/, preprints, opendraft and LaTeX output
  CITEGEIST_LITSEARCH_CACHE   machine-local lookup cache (DBLP, OpenReview, ORCID, h-index)
  OPENALEX_API_KEY            optional, from the citegeist settings
  OPENDRAFT_CONTACT_EMAIL     the citegeist "mailto" setting, sent to OpenAlex and Crossref
  CITEGEIST_KEYCHAIN_SERVICE  Keychain service to read OPENALEX_API_KEY from when it is not set
  CITEGEIST_LIBRARY_ID        id of the library, part of the launchd labels of its watchlists

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


def _keychain(account):
    """A key from the macOS Keychain slot citegeist stores it in, or "" when there is none.

    A launchd agent has no app to hand it the key, so it reads the Keychain itself; the key never
    lands in the agent's plist.
    """
    service = os.environ.get("CITEGEIST_KEYCHAIN_SERVICE", "").strip()
    if not service or not os.path.exists("/usr/bin/security"):
        return ""
    import subprocess
    try:
        res = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return ""
    return res.stdout.strip() if res.returncode == 0 else ""


if not os.environ.get("OPENALEX_API_KEY", "").strip():
    _key = _keychain("openalex")
    if _key:
        os.environ["OPENALEX_API_KEY"] = _key

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
