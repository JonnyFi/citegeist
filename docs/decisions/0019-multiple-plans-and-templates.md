# ADR 0019: Multiple plans and templates

Status: accepted. Date: 2026-10-24.

## Context

One research project can lead to several texts. A doctoral proposal and a paper that grows out of it use the same sources, cards and insights.

## Decision

- A project can have several plans. Plans live under `projects/<slug>/plans/<plan>/` and share the sources, cards and insights of the project.
- Creating a plan offers two templates: an exposé (for a proposal) and IMRaD (for papers). Further text types are added later as template files.

## Consequences

Cards and insights are collected once per project and reused by every plan.
