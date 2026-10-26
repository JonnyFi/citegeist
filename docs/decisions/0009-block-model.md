# ADR 0009: Block model

Status: accepted. Date: 2026-10-23.

## Context

Reading, anchoring quotes and agent access all need to address the same places in a converted document.

## Decision

A converted document is stored as a block model with stable IDs. HTML for reading and Markdown for agents are generated from it.

## Consequences

Quote cards anchor to the text of these documents ([ADR 0010](0010-quote-cards.md)).
