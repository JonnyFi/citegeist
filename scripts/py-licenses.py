"""Print the license metadata of installed Python distributions as JSON.

Reads distribution names from stdin (one per line) and writes a JSON list to stdout. Run it with
the worker's interpreter in isolated mode (see scripts/check-licenses.mjs). Distributions that are
not installed, such as the CUDA wheels that only exist on Linux, are reported with
"installed": false.
"""

import json
import sys
from importlib import metadata

# A License field longer than this is a license text, not a name.
MAX_LICENSE_FIELD = 80

out = []
for line in sys.stdin:
    name = line.strip()
    if not name:
        continue
    try:
        meta = metadata.distribution(name).metadata
    except metadata.PackageNotFoundError:
        out.append({"name": name, "installed": False})
        continue
    field = (meta.get("License") or "").strip()
    if "\n" in field or len(field) > MAX_LICENSE_FIELD:
        field = ""
    classifiers = [
        c.split("::")[-1].strip()
        for c in meta.get_all("Classifier") or []
        if c.startswith("License ::") and c.split("::")[-1].strip() != "OSI Approved"
    ]
    out.append(
        {
            "name": name,
            "installed": True,
            "version": meta.get("Version"),
            "expression": (meta.get("License-Expression") or "").strip(),
            "field": field,
            "classifiers": classifiers,
        }
    )
json.dump(out, sys.stdout)
