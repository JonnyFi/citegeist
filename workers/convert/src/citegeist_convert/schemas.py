"""Validation against the JSON Schemas exported from packages/schema (snapshot in schemas.json).

Refresh the snapshot with `node workers/convert/scripts/export-schemas.mjs`.
"""

from __future__ import annotations

import json
from functools import cache
from importlib import resources
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker


@cache
def _all() -> dict[str, Any]:
    text = resources.files("citegeist_convert").joinpath("schemas.json").read_text("utf-8")
    return json.loads(text)


@cache
def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(_all()[name], format_checker=FormatChecker())


def errors(name: str, instance: Any) -> list[str]:
    out = []
    for e in sorted(validator(name).iter_errors(instance), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in e.absolute_path) or "(root)"
        out.append(f"{path}: {e.message}")
    return out


def validate(name: str, instance: Any) -> None:
    errs = errors(name, instance)
    if errs:
        raise ValueError(f"{name} invalid: " + "; ".join(errs[:5]))


def convert_params_with_defaults(params: dict[str, Any]) -> dict[str, Any]:
    """Apply the zod defaults of WorkerConvertParams (JSON Schema validation does not fill them in)."""
    out = dict(params)
    out.setdefault("ocr", "auto")
    out.setdefault("languages", ["de", "en"])
    return out
