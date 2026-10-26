# ADR 0008: Files as source of truth

Status: accepted. Date: 2026-10-23.

## Context

The library must stay readable and portable without citegeist, and it must survive a lost or corrupted index.

## Decision

The files in the library folder are the truth. SQLite is a machine-local index that can be rebuilt from the files.

## Consequences

The index never goes into a synchronized folder ([ADR 0005](0005-sync-and-versioning.md)). The index rebuilds from the files whenever needed.
