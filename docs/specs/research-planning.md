# Spec: Forschungsplanung pro Projekt

Stand: 2026-10-24, Entwurf zur Abstimmung. Die Spec baut auf `product.md`, `architecture.md` und `decisions.md` auf.

## 1. Problem und Jobs

Ein Projekt hat heute einen Brief, Forschungsfragen und eine Leseliste. Es fehlt ein Ort, an dem aus der Lektüre ein Plan wird. Jonny will pro Projekt einen allgemeinen Modus, in dem er mit einem Agent oder allein überlegt, wie das Projekt weitergeht. Der Zielfall ist die Planung eines PhD-Proposals oder eines Research-Papers.

| Job | Herkunft |
|---|---|
| Mit dem Agent sparren, wie das Projekt weitergeht | Jonny |
| Die Kapitelstruktur gemeinsam aufbauen | Jonny |
| Ein Hauptdokument (.md), das der Agent füllt und Jonny per Hand bearbeitet | Jonny |
| Das Ergebnis zusätzlich als strukturierte Daten | Jonny |
| Unterdokumente für gezielte Fragen, etwa „Wie verbinde ich Kapitel 3 mit Kapitel 4?“ | Jonny |
| Ein Dokument für die Gesamtarchitektur, also wie alles zusammenhängt | Jonny |
| Der Modus funktioniert mit und ohne Agent | Jonny |
| Lücken sehen: Kapitel ohne Quellen, Behauptungen ohne Karte | Vorschlag |
| Aus dem Plan ablesen, welche Literatur noch fehlt | Vorschlag |

Jonny nennt ein Hauptdokument, das der Agent füllt, und ein Hauptdokument für die Gesamtarchitektur. Diese Spec liest beide als dasselbe Dokument (Vorschlag).

## 2. Modell

Jedes Projekt bekommt einen Plan. Er besteht aus einem Hauptdokument mit der Argumentarchitektur, aus Gliederungsknoten (Kapitel und Abschnitte) und aus Unterdokumenten (Übergang, offene Frage, Memo). Alle drei sind Markdown-Dateien mit Frontmatter. Der Index leitet daraus den Gliederungsbaum, die Relationen und die Lücken ab (A3).

### Ort der Wahrheit

- **Jede Angabe hat genau einen Ort.** Reihenfolge und Hierarchie stehen nur im Frontmatter von `plan.md` unter `outline`. Zweck, Status, Behauptungen, Verweise und Relationen eines Knotens stehen nur in seiner eigenen Datei.
- **Menschen schreiben direkt, Agents schreiben über Vorschläge.** Ein Vorschlag ist eine Liste von Operationen, die sich auf den Hash jeder berührten Datei beziehen. Beim Annehmen prüft der Kern den aktuellen Hash. Hat sich eine Datei seitdem geändert, wendet er Feldänderungen an, deren Feld unberührt ist, und führt Textänderungen per Drei-Wege-Merge gegen den gespeicherten Ausgangsstand zusammen. Was sich nicht sauber zusammenführen lässt, markiert er als veraltet, und der Agent schlägt es neu vor. Die Handarbeit gewinnt immer.
- **Stabile IDs.** Jedes Plandokument trägt eine ID `d_<ULID>`. Dateinamen sind Slugs aus dem ersten Titel und bleiben stabil wie Citekeys. Gliederung und Relationen verweisen per Wiki-Link, damit Obsidian sie auflöst. Vorschläge verweisen per ID, damit sie eine Umbenennung überstehen. Eine Datei ohne ID bekommt sie beim ersten Einlesen.
- **Fremde Felder bleiben erhalten.** Der Kern schreibt Frontmatter feldweise und lässt unbekannte Schlüssel stehen.

`AGENTS.md` bekommt die Regel, dass Agents Plandateien über `propose_plan_edit` oder `cg plan propose` ändern. Direkte Änderungen indiziert der Watcher wie bei Notizen.

### Ordner

```
projects/phd-proposal/
  project.md                    Projektbrief (unverändert)
  plan/
    plan.md                     Hauptdokument: These, Gliederung, Text zur Gesamtarchitektur
    nodes/
      kommunikationsbegriff.md  ein Knoten pro Datei, Kapitel oder Abschnitt
      plattformen.md
    docs/
      uebergang-k3-k4.md        Unterdokument
    proposals/
      p_01JC4M7R2X.json         offene Vorschläge, synchronisiert mit der Bibliothek
  exports/
chats/
  2026-10-24-gliederung.md      Planungs-Chat mit project und plan_doc im Frontmatter
```

Entschiedene Vorschläge löscht der Kern. Die Entscheidung steht danach im Chat-Verlauf und im git-Verlauf.

### Beispiele

`plan/plan.md`:

```yaml
id: d_01JC2A0B7Q
kind: plan
title: Plattformen als Kommunikationssysteme
thesis: Plattformen lassen sich mit Luhmanns Kommunikationsbegriff als eigene soziale Systeme beschreiben.
outline:
  - node: "[[einleitung]]"
  - node: "[[kommunikationsbegriff]]"
    children:
      - node: "[[autopoiesis]]"
  - node: "[[plattformen]]"
created: { at: 2026-10-24T09:12:00Z, by: human }
```

`plan/nodes/kommunikationsbegriff.md`:

```yaml
id: d_01JC2C9KQ4
kind: chapter                 # chapter | section
title: Luhmanns Kommunikationsbegriff
purpose: Führt den Begriff ein, auf dem Kapitel 4 die Plattformanalyse aufbaut.
status: draft                 # idea | draft | solid | done
questions: [q1]
claims:
  - id: a1
    text: Kommunikation ist die elementare Operation sozialer Systeme.
    cards: ["[[c_01JB8Z3Q]]"]
    status: supported         # open | supported | contested
sources: ["[[luhmann1984soziale]]"]
relations:
  - to: "[[plattformen]]"
    rel: leads-to             # leads-to | depends-on | contrasts | related
    why: Kapitel 4 wendet den Begriff auf Plattformen an.
    doc: "[[uebergang-k3-k4]]"
    by: agent:claude-code
    status: accepted
```

`plan/docs/uebergang-k3-k4.md`:

```yaml
id: d_01JC3F8W1N
kind: transition              # transition | question | memo
title: Wie verbinde ich Kapitel 3 mit Kapitel 4?
about: ["[[kommunikationsbegriff]]", "[[plattformen]]"]
status: open                  # open | resolved
```

Der Text unter dem Frontmatter ist frei. Im Hauptdokument beschreibt er, wie die Kapitel die These tragen, in einem Knoten den Arbeitsplan des Kapitels.

## 3. Sparring mit dem Agent

Der Planungs-Chat ist die Chat-Seitenleiste aus W3.3 (ACP-Client mit Agent-Auswahl und Kontext-Chips) im Modus „Planung“. Er läuft als `InferenceBackend.session` mit dem citegeist-MCP-Server und `settingSources: []` (A7) und liest Brief, Karten, Notizen und Volltext über die vorhandenen Tools `get_project`, `search`, `list_cards` und `read_document`. Neu kommen `get_plan` und `propose_plan_edit` dazu. Die Sitzung startet mit Brief, Hauptdokument, Gliederung und Lückenliste im Kontext. Für Plandateien hat die Sitzung nur `propose_plan_edit`, jede Änderung kommt also als Vorschlag.

Ein Vorschlag erscheint im Chat als Karte mit Diff. Textänderungen zeigt sie zeilenweise, Feldänderungen als Zeilen „Status: idea → draft“. Jonny nimmt jede Operation einzeln an, verwirft sie oder öffnet sie im Editor und übernimmt seine bearbeitete Fassung als eigene Änderung.

Für eine gezielte Frage schlägt der Agent ein Unterdokument vom Typ `question` oder `transition` vor. Nach dem Annehmen bietet der Chat „Im Unterdokument weiterarbeiten“ an. Das öffnet einen neuen Chat mit diesem Dokument und seinen `about`-Knoten als Kontext.

Ohne Agent bleibt alles außer dem Chat nutzbar, auch die Lückenansicht als reine Index-Abfrage (Grundsatz 6). Externe Agents wie Claude Code im Terminal sparren über dieselben MCP-Tools.

## 4. Verträge

### Operationen

- `plan.init` (write): Eingabe `project`, `title?`. Ausgabe `plan: PlanDoc`. Legt `plan/` mit `plan.md` an.
- `plan.get` (read, MCP `get_plan`, readOnly): Eingabe `project`, `docs?: PlanDocId[]`, `gaps: boolean = true`. Ausgabe `plan: PlanDoc`, `outline: OutlineNode[]` (id, title, kind, status, purpose, Zahl der Behauptungen und Quellen, children), `docs: PlanDocSummary[]`, `bodies?: PlanDoc[]` (frontmatter, body, path, hash), `gaps?: Gap[]`.
- `plan.docs.create` (write): Eingabe `project`, `kind`, `title`, `parent?`, `index?`, `about?`, `body = ""`. Ausgabe `doc`.
- `plan.docs.update` (write): Eingabe `project`, `id`, `baseHash`, `patch` (Teil des Frontmatters), `body?`. Ausgabe `doc`. Fehler `PLAN_STALE` mit dem aktuellen Hash als Fix.
- `plan.docs.trash` (write): Eingabe `project`, `id`. Ausgabe `Ok`. Entfernt den Eintrag aus `outline`.
- `plan.outline.move` (write): Eingabe `project`, `id`, `parent?`, `index`. Ausgabe `outline`.
- `plan.gaps` (read): Eingabe `project`, `kinds?: GapKind[]`. Ausgabe `gaps: Gap[]` (kind, doc, claim?, detail).
- `plan.proposals.create` (write, MCP `propose_plan_edit`): Eingabe `project`, `summary`, `ops: PlanOp[]`, `chat?`. Ausgabe `proposal: Proposal` mit gerendertem Diff.
- `plan.proposals.list` (read): Eingabe `project`, `status?`. Ausgabe `proposals: Proposal[]`.
- `plan.proposals.decide` (write): Eingabe `id`, `accept: int[]`, `reject: int[]`, `edited?: { op: int, text: string }[]`. Ausgabe `applied: int[]`, `stale: int[]`, `docs: PlanDoc[]`.

Damit wächst der MCP-Server von elf auf dreizehn Tools. Die CLI erhält alle Operationen als `cg plan …`.

### Schema (`packages/schema/src/plan.ts`)

- `PlanDocId` (`d_<ULID>`), `ProposalId` (`p_<ULID>`)
- `PlanDocKind`: `plan`, `chapter`, `section`, `transition`, `question`, `memo`
- `NodeStatus`: `idea`, `draft`, `solid`, `done`; `ClaimStatus`: `open`, `supported`, `contested`
- `Claim`: `id` (`a\d+`, eindeutig im Knoten), `text`, `cards: WikiLink[]`, `status`
- `PlanRelation`: `leads-to`, `depends-on`, `contrasts`, `related`; `PlanLink` wie `Link` mit zusätzlichem `doc?: WikiLink`
- `OutlineEntry`: `node: WikiLink`, `children?: OutlineEntry[]`
- `PlanFrontmatter`, `PlanNodeFrontmatter`, `PlanSubdocFrontmatter` gemäß den Beispielen, jeweils mit `created` und `modified` als `Stamp`
- `PlanOp` als Union über `kind`: `createDoc`, `setFields`, `replaceBody` (ganzer Text oder ein Abschnitt per Überschrift), `moveNode`, `addRelation`, `addClaim`, `trashDoc`
- `Proposal`: `id`, `project`, `summary`, `by: Actor`, `at`, `ops`, `base` (pro ID Hash, Frontmatter und Text), `chat?`
- `GapKind`: `chapter-without-sources`, `claim-without-cards`, `question-without-chapter`, `node-without-purpose`, `missing-transition`, `open-subdoc`

`docs/spec/library-format.md` bekommt je eine Zeile für `plan/plan.md`, `plan/nodes/*.md`, `plan/docs/*.md` und `plan/proposals/*.json`.

## 5. Oberfläche

Die Projektansicht bekommt neben Brief und Leseliste einen Tab „Plan“ mit drei Spalten.

- **Gliederungsbaum links:** oben „Gesamtarchitektur“ für `plan.md`, darunter Kapitel und Abschnitte mit Statuspunkt und Lückenzahl. Ziehen ordnet um. Unterdokumente hängen mit eigenem Symbol unter ihren Knoten.
- **Editor in der Mitte:** der CodeMirror-Editor aus W3.1. Über dem Text steht ein Feldbereich für Zweck, Status, Forschungsfragen, Behauptungen mit Karten-Chips, Quellen, Notizen und Relationen. Eine Karte aus dem Kartenpanel lässt sich auf eine Behauptung ziehen.
- **Chat rechts:** die Seitenleiste im Planungsmodus mit Vorschlagskarten (Annehmen, Verwerfen, Bearbeiten, „Alle annehmen“) und dem Zustand „veraltet“ mit „Neu vorschlagen“. Ein Zähler im Tab sammelt Vorschläge externer Agents.
- **Lückenansicht:** eine Liste nach Lückenart, jede Zeile springt zum Knoten.

Die Literaturmatrix (W4.4) lässt sich auf die Quellen eines Kapitels filtern, und eine belegte Zelle kann als Beleg einer Behauptung dienen. Der spätere Schreibtisch übernimmt die Gliederung als Kapitelstruktur und die Behauptungen mit Karten als Stellen, an denen Zitate hingehören. Ein Export fügt die Knoten in Gliederungsreihenfolge zu einem Pandoc-Dokument zusammen (Vorschlag).

## 6. Vorbilder

- **Scrivener:** Jedes Dokument zeigt eine Kurzbeschreibung im Outliner. citegeist übernimmt das als `purpose` und meidet das geschlossene Paketformat ([Indie Author Magazine](https://app.indieauthormagazine.com/?p=2885)).
- **Obsidian Longform:** Die Reihenfolge steht verschachtelt im Frontmatter einer Indexdatei, und Werkzeuge, die dieses YAML neu schreiben, verlieren Kommentare. citegeist übernimmt das Muster und schreibt feldweise ([Scene Subtree Mover](https://community.obsidian.md/plugins/scene-subtree-mover)).
- **Zettlr-Projekte:** Fehlende Dateien der Projektliste erzeugen eine Warnung. citegeist meldet fehlende Knoten in der Problemliste ([Zettlr Docs](https://docs.zettlr.com/en/file-manager/projects.html)).
- **Argdown:** Argumentkarten entstehen aus Klartext mit wenigen Relationstypen. citegeist übernimmt das kleine Vokabular und meidet eine eigene Syntax ([Argdown](https://argdown.org/guide/elements-of-an-argument-map.html)).
- **STORM:** Die Gliederung entsteht aus Fragen verschiedener Perspektiven, bevor Text entsteht. Der Planungs-Agent fragt ebenso zuerst nach ([Stanford](https://storm-project.stanford.edu/research/storm/)).
- **Jenni AI:** Es erzeugt IMRaD-Gliederungen und setzt Zitate aus einer fremden Datenbank ein, die Rezensionen als ungenau beschreiben. citegeist übernimmt Vorlagen und belegt Behauptungen mit eigenen Karten (Grundsatz 3) ([eesel](https://www.eesel.ai/blog/jenni-ai-writing-tool)).

## 7. Einordnung in den Plan

Die Planung gehört in Welle 3. Der Editor kommt aus W3.1, der Chat aus W3.3. Vorher liefert die Lead-Session einen Vertrags-PR mit `plan.ts`, den Operationen und den Zeilen in `library-format.md`.

```markdown
## W3.7 Plan-Kern

Ziel: Pläne liegen als Dateien im Projektordner, der Index kennt Gliederung, Relationen und Lücken, und Vorschläge lassen sich sicher anwenden.
Besitzt: packages/core/src/plan/**
Liest: plan.ts, ops plan.*, diese Spec Abschnitte 2 und 4
Darf nicht ändern: Hotspots, andere Pakete
Abnahme:
- [ ] Rundreise aller Plandateien ohne Verlust, unbekannte Frontmatter-Schlüssel bleiben erhalten
- [ ] Ein Vorschlag gegen eine inzwischen von Hand geänderte Datei wendet unberührte Felder an und markiert kollidierende Textstellen als veraltet
- [ ] Alle sechs Lückenarten auf einem Fixture-Plan ergeben die erwartete Liste
- [ ] get_plan und propose_plan_edit funktionieren im MCP-Client-Test
- [ ] pnpm verify grün
Modell: Sonnet. Größe: L.
```

```markdown
## W3.8 Plan-Oberfläche

Ziel: Jonny plant ein Projekt vollständig von Hand und prüft Vorschläge von Agents.
Besitzt: apps/ui/src/plan/**
Liest: W3.1-Editor, ops plan.*, diese Spec Abschnitt 5
Darf nicht ändern: Hotspots, apps/ui/src/chat/**
Abnahme:
- [ ] Gliederung anlegen, umordnen und Felder bearbeiten im Browser-Build gegen den Mock-Kern
- [ ] Lückenansicht springt zum Knoten
- [ ] Vorschlagsliste mit Annehmen, Verwerfen und Bearbeiten pro Operation
- [ ] /qa grün
Modell: Sonnet. Größe: M.
```

```markdown
## W3.9 Planungs-Chat

Ziel: Der Chat sparrt im Projektkontext und ändert den Plan über Vorschläge.
Besitzt: apps/ui/src/chat/planning/**, packages/ai/tasks/plan-spar/**
Liest: W3.3, W3.7, diese Spec Abschnitt 3
Darf nicht ändern: Hotspots, apps/ui/src/plan/**
Abnahme:
- [ ] Sitzung startet mit Brief, Plan und Lücken im Kontext, gemessen am Mock-Backend
- [ ] Ein Vorschlag aus dem Chat erscheint als Diff-Karte und lässt sich annehmen
- [ ] „Im Unterdokument weiterarbeiten“ öffnet einen Chat mit dem Unterdokument als Kontext
- [ ] Ein manueller Lauf gegen das Abo baut aus einem Fixture-Brief eine Gliederung mit fünf Kapiteln
Modell: Sonnet. Größe: M.
```

Der kleinste nützliche erste Schnitt besteht aus dem Vertrags-PR, W3.7 und einem Teil von W3.8 mit Baum, Lückenansicht und Vorschlagsliste. Damit sparrt Jonny mit Claude Code im Terminal über `get_plan` und `propose_plan_edit` und prüft die Vorschläge in der App. Dieser Schnitt braucht W3.3 nicht und kann starten, sobald W3.1 den Editor liefert.

## 8. Offene Fragen an Jonny

1. **Braucht jeder Abschnitt eine eigene Datei?** Empfehlung: Kapitel bekommen immer eine Datei, Abschnitte erst dann, wenn sie Behauptungen oder Quellen tragen.
2. **Dürfen Agents kleine Änderungen wie Status oder Quellenzuordnung direkt schreiben?** Empfehlung: Jede Agent-Änderung läuft als Vorschlag, und „Alle annehmen“ hält den Aufwand klein.
3. **Hat ein Projekt einen oder mehrere Pläne?** Empfehlung: Ein Projekt hat einen Plan. Ein Paper neben dem Proposal wird ein eigenes Projekt, das dieselben Quellen nutzt.
4. **Welche Gliederungsvorlagen sollen beim Anlegen bereitstehen?** Empfehlung: ein Exposé für das PhD-Proposal und IMRaD für Paper.
