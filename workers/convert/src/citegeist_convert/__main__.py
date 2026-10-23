"""Entry point: `python -m citegeist_convert` serves JSON-RPC on stdio.

Other subcommands:
  serve                 JSON-RPC 2.0 over stdio (default). Exits after CITEGEIST_IDLE_SECONDS without a request (default 600).
  convert <params>      run one conversion, params as JSON string or @file, print the manifest
  install-grobid        download and build GROBID (about 1 GB of downloads, a few minutes)
  download-models       fetch the Docling layout and table models
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def main(argv: list[str] | None = None) -> int:
    # stdout is the JSON-RPC channel: keep library prints away from it.
    # Even C libraries that write to file descriptor 1 end up on stderr this way.
    real_stdout = os.fdopen(os.dup(1), "w", encoding="utf-8", buffering=1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    from . import log

    log.setup_logging()
    parser = argparse.ArgumentParser(prog="citegeist-convert", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("serve")
    p_conv = sub.add_parser("convert")
    p_conv.add_argument("params")
    sub.add_parser("install-grobid")
    sub.add_parser("download-models")
    args = parser.parse_args(argv)
    cmd = args.cmd or "serve"

    if cmd == "serve":
        from .rpc import Server

        idle = float(os.environ.get("CITEGEIST_IDLE_SECONDS", "600"))
        Server(real_stdout, idle_seconds=idle if idle > 0 else None).serve(sys.stdin)
        return 0
    if cmd == "convert":
        from . import convert

        raw = args.params
        params = json.loads(open(raw[1:]).read() if raw.startswith("@") else raw)
        print(json.dumps(convert.run(params), indent=1), file=real_stdout)
        return 0
    if cmd == "install-grobid":
        from . import grobid

        print(str(grobid.install()), file=real_stdout)
        return 0
    if cmd == "download-models":
        from . import models

        print(str(models.ensure_docling_models()), file=real_stdout)
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
