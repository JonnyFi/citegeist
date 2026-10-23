# Spec: Forschungsplanung

Stand: 2026-10-24, Version 2. Sie ersetzt den ersten Entwurf und setzt D11 bis D14 um.

## 1. Kernidee

Jonny liest Quelle X, markiert Stellen, schreibt Notizen, und der Agent fasst sie zusammen. Später liest er Text Y und sieht plötzlich eine Verbindung zu X. Diese Einsicht gehört keiner der beiden Literaturnotizen allein. Sie gehört an einen gemeinsamen Ort: in das Kapitel, das sie betrifft, in ein allgemeines Planungsdokument oder in die Sammlung loser Gedanken des Projekts.

Die Spec dreht sich um zwei Momente. Jonny sagt dem Agent im Chat, was er sieht, und der Agent hält es fest. Später holt der Agent die Einsicht zurück, sobald Jonny ein Kapitel plant oder umbaut. Beides beruht auf festen Feldern, die der Agent aus dem Gespräch anlegt und pflegt. Jonny kann jedes Feld bearbeiten und muss keines selbst ausfüllen. Eine Gliederung entsteht erst, wenn das Gespräch eine braucht.

## 2. Festhalten im Chat

Jonny öffnet die Chat-Seitenleiste rechts und schreibt etwa: „Ich sehe eine Verbindung zwischen Paper A und B, bitte einmal notieren.“

1. Der Agent klärt, was gemeint ist. Die gerade gelesene Quelle, eine Markierung und das offene Projekt stehen als Kontext in der Sitzung. Andere Quellen, Karten und Notizen findet er über `search` und `list_cards`. Bleibt eine Angabe mehrdeutig, stellt er genau eine Rückfrage.
2. Er ruft `capture_insight` auf und füllt die Felder aus Abschnitt 4: Aussage, Verweise, Ort und, wenn erkennbar, die Art der Verbindung. Jonnys Satz bleibt wörtlich in `said`.
3. Er wählt den Ort. Betrifft die Einsicht ein Kapitel, gehört sie dorthin. Reicht sie über Kapitel hinweg, kommt sie ins allgemeine Planungsdokument und nennt die Kapitel in `about`. Ohne passenden Ort landet sie bei den losen Gedanken. Als Hilfe liefert der Kern Kandidaten nach Überschneidung der Quellen.
4. Er antwortet mit einer Zeile: „Notiert in Kapitel 3, Luhmanns Kommunikationsbegriff.“ Die Zeile verlinkt die Einsicht und trägt den Knopf „Rückgängig“.

Das Festhalten ist eine erbetene Änderung und wird direkt geschrieben (D12). Mit abgeschalteter AI legt Jonny eine Einsicht als Notiz vom Typ `insight` von Hand an (Grundsatz 6).

## 3. Zurückholen beim Planen

Bevor der Planungs-Chat antwortet, ruft der Kern `insights.relevant` auf. Die Suche arbeitet in zwei Stufen.

- **Felder zuerst.** Treffer sind Einsichten, deren `space` oder `about` auf das besprochene Kapitel zeigt, die Quellen oder Karten mit dem Kapitel oder mit der Quelle im Reader teilen oder die zu einer Forschungsfrage des Kapitels gehören. Diese Treffer sortiert der Kern nach Zahl der Übereinstimmungen und dann nach Datum.
- **Text danach.** Bleiben Plätze frei, füllt die Textsuche über `text` und den Fließtext auf, mit lokalen Embeddings aus W3.4 und bis dahin mit FTS5.

Die besten fünf kommen mit Datum, Ort, Aussage, Verweisen und dem Grund des Treffers in den Kontext des Zugs. Die Sitzungsanweisung verlangt, eine Einsicht zu nennen, sobald sie die Antwort berührt, und sie als `[[n_…]]` zu zitieren: „Zu Kapitel 3 hast du am 12.11. notiert, dass A und B denselben Mechanismus beschreiben.“ Die Oberfläche zeigt das Zitat als Chip. Ein Verweis auf eine Einsicht, die es nicht gibt, wird markiert wie ein unbelegtes Zitat (Grundsatz 3). Über `find_insights` sucht der Agent selbst weiter.

## 4. Strukturierte Daten

Alle Felder stehen im YAML-Frontmatter der jeweiligen Datei. Jedes Objekt ist eine Datei, Obsidian zeigt die Felder als Eigenschaften, und ein Sync-Konflikt trifft höchstens ein Objekt. Der Index liest die Felder in eigene Tabellen (A3). Die Schemas kommen als `insight.ts` und `plan.ts` nach `packages/schema`.

### Einsicht

Eine Einsicht ist eine Notiz vom Typ `insight` in `notes/`. Sie nutzt damit alles, was Notizen in W3.1 bis W3.4 bekommen.

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | `NoteId` | stabil |
| `type` | `"insight"` | |
| `title` | string | kurz, vom Agent |
| `text` | string | die Aussage in ein bis drei Sätzen |
| `said` | string, optional | Jonnys Wortlaut im Chat |
| `links` | `Link[]` | Verweise auf Quellen, Karten und Notizen, je mit `rel`, falls bekannt |
| `relation` | optional | `{ rel: Relation, from: WikiLink, to: WikiLink }`, die erkannte Art der Verbindung |
| `plan` | `PlanSlug`, optional | |
| `space` | `WikiLink`, optional | Kapitel, Abschnitt (`[[kapitel#s2]]`) oder `[[plan]]`; leer heißt lose |
| `about` | `WikiLink[]` | weitere Kapitel, die die Einsicht betrifft |
| `projects`, `created`, `modified` | wie bei Notizen | `created.by` nennt Mensch oder Agent |

```yaml
id: n_01JC5Q2M8T
type: insight
title: Anschlusskommunikation und Ranking-Feedback
text: Gillespies Feedbackschleife bei Rankings ist ein Fall von Luhmanns Anschlusskommunikation.
said: Ich sehe eine Verbindung zwischen Luhmann und Gillespie, bitte einmal notieren.
links:
  - { to: "[[c_01JB8Z3Q]]", by: agent:claude-code }
  - { to: "[[gillespie2018custodians]]", by: agent:claude-code }
relation: { rel: extends, from: "[[gillespie2018custodians]]", to: "[[luhmann1984soziale]]" }
plan: proposal
space: "[[kommunikationsbegriff]]"
projects: [phd-proposal]
created: { at: 2026-11-12T10:02:00Z, by: agent:claude-code }
```

### Plan, Kapitel und Abschnitt

Ein Projekt hat einen oder mehrere Pläne (D13). Beim Anlegen stehen die Vorlagen „Exposé“ und „IMRaD“ bereit (D14).

```
projects/phd-proposal/
  plans/proposal/
    plan.md                       Planungsdokument, Feld outline
    chapters/kommunikationsbegriff.md
    chapters/autopoiesis.md       Abschnitt mit Quellen, deshalb eigene Datei
  proposals/p_01JC4M7R2X.json     Vorschläge ungefragter Agent-Änderungen
```

- **`plan.md`:** `id` (`d_<ULID>`), `title`, `template`, `outline` als geordnete Liste von Kapitel-Links. Die Reihenfolge der Kapitel ist ihre Position in `outline`.
- **Kapitel:** `id`, `title`, `purpose`, `status` (`idea`, `draft`, `solid`, `done`), `questions` (IDs aus `project.md`), `sources` (Citekeys), `cards`, `claims` (optional, `{ id, text, cards }`), `sections` und `relations` (`leads-to`, `depends-on`, `contrasts`, `related`).
- **Abschnitt:** ein Eintrag in `sections` mit `id` (`s1`, `s2`), `title`, `purpose`, `status` und `questions`. Die Reihenfolge ist die Position in der Liste. Bekommt ein Abschnitt Quellen, Karten oder Behauptungen, legt der Agent für ihn eine eigene Datei mit den Kapitelfeldern an, und der Eintrag schrumpft auf `{ id, file }` (D11). Seine Felder stehen damit immer an genau einer Stelle.

```yaml
id: d_01JC2C9KQ4
title: Luhmanns Kommunikationsbegriff
purpose: Führt den Begriff ein, auf dem Kapitel 4 aufbaut.
status: draft
questions: [q1]
sources: [luhmann1984soziale, gillespie2018custodians]
cards: ["[[c_01JB8Z3Q]]"]
sections:
  - { id: s1, title: Kommunikation als Operation, status: idea }
  - { id: s2, file: "[[autopoiesis]]" }
relations:
  - { to: "[[plattformen]]", rel: leads-to, by: agent:claude-code }
```

Welche Einsichten zu einem Kapitel gehören, steht nur in den Einsichten (`space`, `about`). `plans.get` liefert diese Liste abgeleitet mit.

### Fließtext und Felder

Jede Angabe hat einen Ort. Die Felder halten die Struktur, der Fließtext unter dem Frontmatter hält die Formulierung. Titel, Reihenfolge und Zuordnungen stehen deshalb nur in Feldern, und der Fließtext verweist per Wiki-Link oder `[@citekey]` darauf. Die Planansicht zeigt über dem Fließtext eine Gliederung, die sie aus den Feldern rendert.

Nach jedem Schreibvorgang prüft der Kern beide Seiten gegeneinander. Die Prüfung findet Wiki-Links auf Kapitel außerhalb von `outline`, Überschriften im Kapiteltext ohne Eintrag in `sections` und `[@citekey]` im Text ohne Eintrag in `sources`. Für den Agent heißt das: Ändert er im Chat Text, der Struktur betrifft, gleicht er die Felder im selben Zug über `update_plan_structure` an. Meldet die Prüfung danach noch Abweichungen, bekommt er sie zurück, bevor der Zug endet. Ändert Jonny Text von Hand, erscheint die Abweichung als Hinweis in der Planansicht, und der Agent legt einen Vorschlag für die Felder an, weil niemand darum gebeten hat (D12).

## 5. Änderungen durch den Agent

- **Im Chat erbetene Änderungen schreibt der Agent direkt.** Sagt Jonny „so will ich das, formuliere das mal aus“, steht der Text sofort im Dokument, mit `modified.by: agent:<name>`.
- **Jede Änderung lässt sich zurücknehmen.** Der Kern legt vor jedem Schreiben die vorige Fassung im Verlauf der Datei ab und ordnet sie dem Agent-Zug zu. „Rückgängig“ stellt alle Dateien eines Zugs wieder her. Hat Jonny dazwischen selbst geändert, führt der Kern beide Stände per Drei-Wege-Merge zusammen und zeigt Konflikte an. Der Verlauf liegt rechnerlokal unter Application Support, geräteübergreifend hilft git (A9).
- **Der Prüfmodus ist wählbar.** Pro Projekt (`agent_edits: review`) oder pro Chat kommen Änderungen als Vorschlag mit Diff.
- **Ungefragte Änderungen kommen als Vorschlag.** Das gilt für Hintergrundjobs und für externe Agents außerhalb eines citegeist-Chats.

## 6. Verträge

- `insights.capture` (write, MCP `capture_insight`): Felder der Einsicht ohne `id` und `created`. Ausgabe `note`, `candidates` (Orte nach Überschneidung der Quellen).
- `insights.update` (write): `id`, `baseHash`, `patch`. Einsichten verschieben heißt `space` ändern.
- `insights.relevant` (read, MCP `find_insights`): `project`, `plan?`, `chapter?`, `refs?`, `query?`, `limit = 5`. Ausgabe Treffer mit Feldern, `stage` (`fields` oder `text`) und `why`.
- `plans.create` (write): `project`, `slug`, `title`, `template?`.
- `plans.get` (read, MCP `get_plan`): Felder von `plan.md`, alle Kapitel und Abschnitte mit Feldern, abgeleitete Einsichten pro Ort, Abweichungen aus der Prüfung.
- `plans.list` (read): `project`.
- `plan.structure.apply` (write, MCP `update_plan_structure`): `project`, `plan`, `ops` als Liste aus `upsertChapter`, `upsertSection`, `moveChapter`, `moveSection`, `splitSection` (eigene Datei), `setInsightSpace`. Alles in einem Aufruf ist atomar und ein Schritt im Verlauf.
- `plan.docs.update` (write, MCP `edit_plan_doc`): `project`, `plan`, `id`, `baseHash`, `body`. Ändert nur den Fließtext.
- `history.list`, `history.restore`, `history.revertTurn` (write): Verlauf einer Datei, eine Fassung wiederherstellen, einen Agent-Zug zurücknehmen.
- `proposals.list`, `proposals.decide` (write): Vorschläge einsehen, annehmen oder verwerfen.

Akteur, Chat-Zug und Prüfmodus entscheiden bei jeder schreibenden Operation, ob sie direkt schreibt oder einen Vorschlag anlegt. Dazu bekommt `NoteType` den Wert `insight`, `ProjectFrontmatter` das Feld `agent_edits` mit Standard `direct`, und `library-format.md` Zeilen für `plans/` und `proposals/`.

## 7. Oberfläche

- **Chat-Seitenleiste:** Bestätigungszeile nach dem Festhalten, zitierte Einsichten als Chips mit Datum, „Rückgängig“ an jedem Agent-Zug mit Änderungen.
- **Planansicht:** ein Tab pro Plan. Links stehen „Allgemein“, die Kapitel und „Lose Gedanken“ mit Zähler. In der Mitte stehen die Felder als bearbeitbares Formular, darunter Fließtext und Einsichten des Orts.
- **Verlauf:** pro Datei eine Liste der Fassungen mit Herkunft.

Die Literaturmatrix (W4.4) filtert auf die Quellen eines Kapitels, und der spätere Schreibtisch übernimmt die Kapitel als Gliederung.

## 8. Vorbilder

- **Obsidian Longform:** Die Reihenfolge steht im Frontmatter einer Indexdatei. citegeist übernimmt das für `outline` ([Scene Subtree Mover](https://community.obsidian.md/plugins/scene-subtree-mover)).
- **STORM:** Die Gliederung entsteht aus Fragen, bevor Text entsteht. Der Planungs-Agent fragt ebenso zuerst nach ([Stanford](https://storm-project.stanford.edu/research/storm/)).
- **Jenni AI:** Es setzt Zitate aus einer fremden Datenbank ein. citegeist belegt mit eigenen Karten und Einsichten (Grundsatz 3) ([eesel](https://www.eesel.ai/blog/jenni-ai-writing-tool)).

## 9. Einordnung

Die Arbeit gehört in Welle 3. Die Steckbriefe W3.7 bis W3.9 stehen in `development-plan.md`. Vorher liefert die Lead-Session die Schemas und Verträge aus den Abschnitten 4 und 6.

Der erste Schnitt umfasst W3.7 und das Festhalten aus W3.9: Einsichten mit festen Feldern, `capture_insight` und `find_insights` mit der Feldstufe, dazu Verlauf und „Rückgängig“. Bis die Seitenleiste aus W3.3 steht, läuft derselbe Ablauf mit Claude Code über MCP. Danach folgen Pläne mit Kapitelfeldern, das Zurückholen im Planungs-Chat und die Planansicht.

## 10. Offene Fragen an Jonny

1. **Wie lange bewahrt der Verlauf Fassungen auf?** Empfehlung: 90 Tage für alle Fassungen, danach eine pro Tag.
2. **Soll der Agent Einsichten auch beim Lesen zurückholen, etwa beim Öffnen von Quelle B?** Empfehlung: zuerst nur im Planungs-Chat, später als leiser Hinweis im Reader.
