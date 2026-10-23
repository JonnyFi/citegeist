"""GROBID without Docker.

GROBID 0.9.1 runs natively on macOS arm64: a Java service jar plus its CRF models. The worker fetches
everything lazily into the machine-local models dir, with pinned versions and checksums:

* a Temurin JRE (runtime), and a Temurin JDK that exists only while building,
* the GROBID 0.9.1 source tag, built once with Gradle into the service jar,
* the CRF models, native libraries and pdfalto binaries for mac arm64 from the source tree.

GROBID is optional. Mode comes from `CITEGEIST_GROBID`:

* `auto` (default): use GROBID if it is installed, otherwise skip it and flag the result,
* `install`: install on first use (needs about 1 GB of downloads and a few minutes),
* `off`: never use it.

`CITEGEIST_GROBID_URL` points the worker at an already running service instead (for example a Docker container).
"""

from __future__ import annotations

import atexit
import contextlib
import hashlib
import logging
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

import requests
from lxml import etree

from . import log, models
from .errors import ConvertError

_log = logging.getLogger(__name__)
VERSION = "0.9.1"
TEMURIN = "jdk-21.0.13%2B9"
TEMURIN_FILE = "21.0.13_9"
JRE = {
    "url": f"https://github.com/adoptium/temurin21-binaries/releases/download/{TEMURIN}/OpenJDK21U-jre_aarch64_mac_hotspot_{TEMURIN_FILE}.tar.gz",
    "sha256": "225bab0a09491ef06835488cd942f5d2befa9a0410a2484f0c8bbcf7506ec09a",
    "size_mb": 48,
}
JDK = {
    "url": f"https://github.com/adoptium/temurin21-binaries/releases/download/{TEMURIN}/OpenJDK21U-jdk_aarch64_mac_hotspot_{TEMURIN_FILE}.tar.gz",
    "sha256": "bf036b35b071bfb2f54f2c0af8ee8d88afa95ee6eb3dce02c0f94cfc2524d04a",
    "size_mb": 200,
}
SOURCE = {
    "url": f"https://github.com/grobidOrg/grobid/archive/refs/tags/{VERSION}.tar.gz",
    "sha256": "e5fc91e2231d2ef0ae4e7f9d098cd84a702fb14fc823d2f70ae048481f15c374",
    "size_mb": 393,
}
TEI = {"t": "http://www.tei-c.org/ns/1.0"}
JAVA_OPENS = [
    "--add-opens=java.base/java.lang=ALL-UNNAMED",
    "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
    "--add-opens=java.base/java.io=ALL-UNNAMED",
]

_server: dict[str, Any] = {}


def mode() -> str:
    return os.environ.get("CITEGEIST_GROBID", "auto")


def install_dir() -> Path:
    return models.models_dir() / "grobid" / VERSION


def supported() -> bool:
    return sys.platform == "darwin" and platform.machine() == "arm64"


def installed() -> bool:
    return (install_dir() / ".installed").exists()


def status() -> str:
    if mode() == "off":
        return "off"
    if os.environ.get("CITEGEIST_GROBID_URL"):
        return "external"
    if installed():
        return f"{VERSION} installed"
    return "not installed" if supported() else "unsupported platform"


# ---------------------------------------------------------------------------------------- install


def _download(spec: dict[str, Any], target: Path, what: str) -> None:
    log.progress(f"Downloading {what} (about {spec['size_mb']} MB)", 0.0)
    h = hashlib.sha256()
    req = urllib.request.Request(spec["url"], headers={"User-Agent": "citegeist-convert"})
    with urllib.request.urlopen(req, timeout=60) as r, open(target, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done, last = 0, 0.0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            h.update(chunk)
            done += len(chunk)
            if total and done / total - last >= 0.1:
                last = done / total
                log.progress(f"Downloading {what}", last)
    if h.hexdigest() != spec["sha256"]:
        raise ConvertError(
            "DOWNLOAD_CHECKSUM",
            f"{what} has sha256 {h.hexdigest()}, expected {spec['sha256']}",
            "Retry the download. If it fails again the pinned release changed and the pin in grobid.py needs an update.",
            recovery="retry",
            context={"url": spec["url"]},
        )


def _extract(archive: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as t:
        t.extractall(dest, filter="data")
    entries = [p for p in dest.iterdir() if not p.name.startswith(".")]
    return entries[0] if len(entries) == 1 else dest


def _java_home(extracted: Path) -> Path:
    home = extracted / "Contents" / "Home"
    return home if home.exists() else extracted


def _prune_models(home: Path) -> None:
    """Keep the CRF models only. The deep learning variants need DeLFT, which the worker does not install."""
    mdir = home / "models"
    for d in mdir.iterdir():
        if "BidLSTM" in d.name or d.name.endswith("_gru") or d.name == "patent":
            shutil.rmtree(d, ignore_errors=True)
    for sub in ("lib", "pdfalto"):
        for d in (home / sub).iterdir():
            if d.is_dir() and d.name not in ("mac_arm-64", "languages"):
                shutil.rmtree(d, ignore_errors=True)


def install() -> Path:
    """Install GROBID into the models dir. Idempotent. Raises ConvertError on failure."""
    target = install_dir()
    if installed():
        return target
    if not supported():
        raise ConvertError(
            "GROBID_UNSUPPORTED",
            f"native GROBID install is only supported on macOS arm64, this is {sys.platform}/{platform.machine()}",
            "Run a GROBID service yourself and set CITEGEIST_GROBID_URL, or continue without GROBID.",
            recovery="ask-human",
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    lock = target.parent / ".install.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except FileExistsError:
        raise ConvertError(
            "GROBID_INSTALL_RUNNING",
            f"another install holds {lock}",
            f"Wait for it to finish, or delete {lock} if no install is running.",
            recovery="retry",
        ) from None
    work = Path(tempfile.mkdtemp(prefix="grobid-install-", dir=target.parent))
    try:
        log.progress(f"Installing GROBID {VERSION} (one time, about 1 GB of downloads, a few minutes)", 0.0)
        shutil.rmtree(target, ignore_errors=True)
        stage = work / "stage"
        stage.mkdir()
        _download(JRE, work / "jre.tgz", "Java runtime")
        jre = _java_home(_extract(work / "jre.tgz", work / "jre"))
        shutil.copytree(jre, stage / "jre", symlinks=True)
        _download(JDK, work / "jdk.tgz", "Java development kit (build only)")
        jdk = _java_home(_extract(work / "jdk.tgz", work / "jdk"))
        _download(SOURCE, work / "src.tgz", f"GROBID {VERSION} source")
        src = _extract(work / "src.tgz", work / "src")
        log.progress("Building GROBID (Gradle, a few minutes)", 0.0)
        env = {
            **os.environ,
            "JAVA_HOME": str(jdk),
            "GRADLE_USER_HOME": str(work / "gradle"),
        }
        proc = subprocess.run(
            ["./gradlew", ":grobid-service:shadowJar", "-x", "test", "--no-daemon", "--console=plain", "-q"],
            cwd=src,
            env=env,
            stdout=sys.stderr,
            stderr=sys.stderr,
            check=False,
        )
        jars = list((src / "grobid-service" / "build" / "libs").glob("grobid-service-*-onejar.jar"))
        if proc.returncode != 0 or not jars:
            raise ConvertError(
                "GROBID_BUILD_FAILED",
                f"Gradle exited with {proc.returncode} and produced {len(jars)} service jar(s)",
                "Read the worker stderr log, fix the cause (network, disk space), then retry the install.",
                recovery="fix-and-retry",
                side_effects="none",
            )
        shutil.copy2(jars[0], stage / "grobid-service.jar")
        shutil.copytree(src / "grobid-home", stage / "grobid-home", symlinks=True)
        _prune_models(stage / "grobid-home")
        (stage / ".installed").write_text(VERSION)
        stage.rename(target)
        log.progress(f"GROBID {VERSION} installed", 1.0)
        return target
    finally:
        shutil.rmtree(work, ignore_errors=True)
        with contextlib.suppress(OSError):
            lock.unlink()


# ------------------------------------------------------------------------------------------ server


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _write_config(home: Path, port: int, admin: int, out: Path) -> None:
    text = (home / "config" / "grobid.yaml").read_text()
    text = text.replace('grobidHome: "grobid-home"', f'grobidHome: "{home}"')
    text = re.sub(r'(?m)^(\s*)temp: "tmp"', rf'\1temp: "{out.parent / "tmp"}"', text)
    text = re.sub(r"(?m)^(\s*)port: 8070\s*$", rf"\1port: {port}\n\1bindHost: 127.0.0.1", text)
    text = re.sub(r"(?m)^(\s*)port: 8071\s*$", rf"\1port: {admin}\n\1bindHost: 127.0.0.1", text)
    text = re.sub(r"(?m)^(\s*)concurrency: \d+", r"\1concurrency: 2", text)
    text = re.sub(r"(?m)^(logging:\s*\n\s*level:) \w+", r"\1 WARN", text)
    out.write_text(text)


def _stop() -> None:
    proc = _server.get("proc")
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    _server.clear()


def base_url() -> str | None:
    """URL of a usable GROBID service, starting it if needed. None when GROBID is not available."""
    if mode() == "off":
        return None
    ext = os.environ.get("CITEGEIST_GROBID_URL")
    if ext:
        return ext.rstrip("/")
    proc = _server.get("proc")
    if proc and proc.poll() is None:
        return _server["url"]
    if not installed():
        if mode() != "install":
            return None
        install()
    home_root = install_dir()
    port, admin = _free_port(), _free_port()
    run_dir = Path(tempfile.mkdtemp(prefix="grobid-run-", dir=models.models_dir() / "grobid"))
    cfg = run_dir / "run" / "grobid.yaml"
    cfg.parent.mkdir()
    _write_config(home_root / "grobid-home", port, admin, cfg)
    log.progress("Starting GROBID")
    proc = subprocess.Popen(
        [
            str(home_root / "jre" / "bin" / "java"),
            "-Xmx2g",
            *JAVA_OPENS,
            "-jar",
            str(home_root / "grobid-service.jar"),
            "server",
            str(cfg),
        ],
        stdout=subprocess.DEVNULL,
        stderr=sys.stderr,
        cwd=run_dir,
        start_new_session=True,
    )
    url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 120
    while time.time() < deadline:
        if proc.poll() is not None:
            shutil.rmtree(run_dir, ignore_errors=True)
            raise ConvertError(
                "GROBID_START_FAILED",
                f"GROBID exited with code {proc.returncode} during start",
                "Read the worker stderr log. Set CITEGEIST_GROBID=off to convert without GROBID.",
                recovery="fix-and-retry",
            )
        try:
            if requests.get(f"{url}/api/isalive", timeout=2).text.strip() == "true":
                break
        except requests.RequestException:
            time.sleep(0.5)
    else:
        proc.kill()
        raise ConvertError(
            "GROBID_START_TIMEOUT",
            "GROBID did not answer on /api/isalive within 120 seconds",
            "Check memory pressure and the worker stderr log, then retry. CITEGEIST_GROBID=off skips GROBID.",
            recovery="retry",
        )
    _server.update(proc=proc, url=url, run_dir=run_dir)
    atexit.register(_stop)
    atexit.register(lambda: shutil.rmtree(run_dir, ignore_errors=True))
    return url


# ---------------------------------------------------------------------------------------- calls


def _post(url: str, endpoint: str, pdf: Path, **data: str) -> str | None:
    with open(pdf, "rb") as f:
        r = requests.post(
            f"{url}/api/{endpoint}",
            files={"input": f},
            data=data,
            headers={"Accept": "application/xml"},
            timeout=180,
        )
    if r.status_code == 204:
        return None
    r.raise_for_status()
    return r.text


def _text(el) -> str:
    return " ".join("".join(el.itertext()).split()) if el is not None else ""


def _name(p) -> str:
    parts = [" ".join("".join(c.itertext()).split()) for c in p] or ["".join(p.itertext())]
    return " ".join(x for x in parts if x)


def parse_header(xml: str) -> dict[str, Any]:
    root = etree.fromstring(xml.encode())
    authors = []
    for p in root.xpath("//t:fileDesc/t:sourceDesc/t:biblStruct/t:analytic/t:author/t:persName", namespaces=TEI):
        authors.append(_name(p))
    doi = root.xpath("string(//t:sourceDesc//t:idno[@type='DOI'])", namespaces=TEI).strip() or None
    date = (
        root.xpath("string(//t:publicationStmt/t:date/@when)", namespaces=TEI)
        or root.xpath("string(//t:monogr/t:imprint/t:date/@when)", namespaces=TEI)
        or None
    )
    abstract = _text((root.xpath("//t:profileDesc/t:abstract", namespaces=TEI) or [None])[0])
    return {
        "title": _text((root.xpath("//t:fileDesc/t:titleStmt/t:title", namespaces=TEI) or [None])[0]),
        "authors": [a for a in authors if a],
        "doi": doi,
        "date": date,
        "abstract": abstract or None,
    }


def parse_references(xml: str) -> list[dict[str, Any]]:
    root = etree.fromstring(xml.encode())
    refs = []
    for i, b in enumerate(root.xpath("//t:listBibl/t:biblStruct", namespaces=TEI)):
        title = _text((b.xpath("t:analytic/t:title", namespaces=TEI) or b.xpath("t:monogr/t:title", namespaces=TEI) or [None])[0])
        venue = _text((b.xpath("t:monogr/t:title", namespaces=TEI) or [None])[0]) if b.xpath("t:analytic/t:title", namespaces=TEI) else ""
        authors = [_name(p) for p in b.xpath("t:analytic/t:author/t:persName | t:monogr/t:author/t:persName", namespaces=TEI)]
        year = (b.xpath("string(.//t:imprint/t:date/@when)", namespaces=TEI) or "")[:4] or None
        raw = _text((b.xpath("t:note[@type='raw_reference']", namespaces=TEI) or [None])[0])
        refs.append(
            {
                "key": f"r{i}",
                "raw": raw or None,
                "title": title or None,
                "venue": venue or None,
                "authors": [a for a in authors if a],
                "year": year,
                "doi": b.xpath("string(.//t:idno[@type='DOI'])", namespaces=TEI).strip() or None,
                "source": "grobid",
            }
        )
    return refs


def process(pdf: Path) -> dict[str, Any] | None:
    """Header and references from GROBID, or None when GROBID is not available."""
    try:
        url = base_url()
    except ConvertError as e:
        _log.warning("GROBID unavailable: %s", e)
        return {"error": e.detail()}
    if url is None:
        return None
    out: dict[str, Any] = {"header": None, "references": [], "version": VERSION}
    try:
        hx = _post(url, "processHeaderDocument", pdf, consolidateHeader="0")
        if hx:
            out["header"] = parse_header(hx)
        rx = _post(url, "processReferences", pdf, consolidateCitations="0", includeRawCitations="1")
        if rx:
            out["references"] = parse_references(rx)
    except (requests.RequestException, etree.XMLSyntaxError) as e:
        _log.warning("GROBID call failed for %s: %s", pdf.name, e)
        return {"error": {"code": "GROBID_CALL_FAILED", "message": str(e)}}
    return out
