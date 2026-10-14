# 0004 — MVP widgets are Kitchen-specific, but not coupled to Kitchen

**Status:** Accepted · 2026-10-13 · Decided by Vero

## Decision
The initial widget set may be implemented explicitly for the Kitchen Assistant. The broader product is expected to support additional specialist widgets later, so this implementation should avoid unnecessary coupling that would make future expansion difficult.

## Widgets in MVP 1
Kitchen, Meal ideas and Meal plan. The primary journey needs all three (see 0005).
The optional "What changed" widget is **still open**.

## Guidance for specialists
No general plugin framework in MVP 1. The aim is simply that adding a future widget, like a Fitness one, doesn't require rewriting the Kitchen widgets or the workspace that hosts them.
