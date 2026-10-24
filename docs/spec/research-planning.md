# Spec: Forschungsplanung

Stand: 2026-10-24, Version 2. Sie ersetzt den ersten Entwurf und setzt D11 bis D14 um.

## 1. Kernidee

Jonny liest Quelle X, markiert Stellen, schreibt Notizen, und der Agent fasst sie zusammen. Später liest er Text Y und sieht plötzlich eine Verbindung zu X. Diese Einsicht gehört keiner der beiden Literaturnotizen allein. Sie gehört an einen gemeinsamen Ort: in das Kapitel, das sie betrifft, in das Planungsdokument oder in die Einsichten-Datei des Projekts.

Die Spec dreht sich um zwei Momente. Jonny sagt dem Agent im Chat, was er sieht, und der Agent schreibt es an den richtigen Ort. Später holt der Agent die Einsicht zurück, sobald Jonny ein Kapitel plant oder umbaut. Gedanken bleiben Fließtext. Feste Felder gibt es nur für das Gerüst, also für die Gliederung aus Kapiteln und Abschnitten.

## 2. Festhalten im Chat

Jonny öffnet die Chat-Seitenleiste rechts und schreibt etwa: „Ich sehe eine Verbindung zwischen Paper A und B, bitte einmal notieren.“

1. Der Agent klärt, was gemeint ist. Die gerade gelesene Quelle, eine Markierung und das offene Projekt stehen als Kontext in der Sitzung. Andere Quellen, Karten und Notizen findet er über `search` und `list_cards`. Bleibt eine Angabe mehrdeutig, stellt er genau eine Rückfrage.
2. Er formuliert die Einsicht als Absatz und setzt Wiki-Links auf die gemeinten Citekeys, Karten und Gliederungsknoten.
3. Er wählt den Ort. Betrifft die Einsicht ein Kapitel oder einen Abschnitt, kommt sie in dessen Dokument. Reicht sie über Kapitel hinweg, kommt sie ins Planungsdokument. Gibt es keinen passenden Ort, landet sie in der Einsichten-Datei des Projekts.
4. Er schreibt den Absatz mit `note_insight` und antwortet mit einer Zeile: „Notiert in 3, Luhmanns Kommunikationsbegriff.“ Die Zeile verlinkt den Absatz und trägt den Knopf „Rückgängig“.

Das Festhalten ist eine erbetene Änderung und wird direkt geschrieben (D12). Ohne AI schreibt Jonny denselben Absatz von Hand in dieselbe Datei (Grundsatz 6).

### Form einer Einsicht

Eine Einsicht ist ein Absatz im Markdown-Text. Sie beginnt mit dem Datum und endet mit einer Block-ID, die der Kern beim Schreiben setzt:

```markdown
2026-11-12: Gillespies Feedbackschleife bei Rankings ist ein Fall von Anschlusskommunikation
im Sinne von [[luhmann1984soziale]] ([[c_01JB8Z3Q]]), und [[gillespie2018custodians]] liefert
dafür den empirischen Fall. Das trägt den Übergang zu [[k_01JC7D4E2F]]. ^i-01JC5Q2M8T
```

Die Struktur ergibt sich aus dem Text selbst. Die Wiki-Links nennen Quellen, Karten und Knoten, die Datei nennt den Ort, und das Datum nennt den Zeitpunkt. Die Herkunft steht im Verlauf der Datei. Die Block-ID macht den Absatz zitierbar, etwa als `[[kommunikationsbegriff#^i-01JC5Q2M8T]]`.

## 3. Zurückholen beim Planen

Plant Jonny im Chat ein Kapitel, ruft der Kern vor der Antwort `find_insights` für dessen Knoten auf. Die Suche arbeitet in zwei Stufen.

- **Links zuerst.** Treffer sind Absätze im Dokument des Knotens und seiner Unterknoten, Absätze anderswo im Projekt mit einem Link auf den Knoten und Absätze mit einem Link auf eine Quelle oder Karte, die das Dokument des Knotens verlinkt. Diese Treffer sortiert der Kern nach Zahl der gemeinsamen Links und dann nach Datum.
- **Semantische Suche danach.** Bleiben Plätze frei, sucht der Kern über alle Absätze des Projekts mit lokalen Embeddings aus W3.4, bis dahin mit FTS5.

Die besten fünf kommen mit Datum, Datei, Text und Grund des Treffers in den Kontext des Zugs. Die Sitzungsanweisung verlangt, eine Einsicht zu nennen, sobald sie die Antwort berührt, und sie per Block-Link zu zitieren: „Zu Kapitel 3 hast du am 12.11. notiert, dass A und B denselben Mechanismus beschreiben.“ Die Oberfläche zeigt das Zitat als Chip. Ein Verweis auf einen Absatz, den es nicht gibt, wird markiert wie ein unbelegtes Zitat (Grundsatz 3).

Der Index zerlegt dafür jede Plandatei und die Einsichten-Datei in Absätze und hält Block-ID, Datei, Datum, ausgehende Links und Vektor pro Absatz. Die Links landen in der vorhandenen Kantentabelle des Graphen.

## 4. Gliederung

Die Gliederung ist das einzige Objekt mit festen Feldern. Sie liegt pro Plan in `outline.yaml`. Jeder Knoten hat diese Felder:

| Feld | Bedeutung |
|---|---|
| `id` | `k_<ULID>`, stabil |
| `title` | Titel |
| `parent` | ID des Elternknotens, `null` für Kapitel |
| `order` | Position unter Geschwistern, ganze Zahl |
| `purpose` | optional, ein Satz zum Zweck |
| `status` | `idea`, `draft`, `solid` oder `done` |
| `questions` | IDs der Forschungsfragen aus `project.md` |

```yaml
nodes:
  - { id: k_01JC2C9KQ4, title: Luhmanns Kommunikationsbegriff, parent: null, order: 3,
      purpose: Führt den Begriff ein, auf dem Kapitel 4 aufbaut., status: draft, questions: [q1] }
  - { id: k_01JC6A1B2C, title: Anschlusskommunikation, parent: k_01JC2C9KQ4, order: 1, status: idea }
```

Nummern wie „4.4“ berechnet citegeist aus `parent` und `order` und speichert sie nie. Text verweist auf Knoten per ID, etwa `[[k_01JC6A1B2C]]`, und citegeist zeigt den Link als „3.1 Anschlusskommunikation“ an. Ein Umordnen nummeriert deshalb neu, und alle Links bleiben gültig.

Ein Kapitel hat immer ein eigenes Dokument. Ein Abschnitt bekommt erst eines, wenn er Behauptungen oder Quellen trägt (D11), bis dahin stehen seine Einsichten im Dokument des Kapitels. Ein Dokument trägt im Frontmatter nur `node` und denselben Wert unter `aliases`, damit Obsidian Links auf den Knoten zur Datei auflöst. Links auf Abschnitte ohne Dokument löst nur citegeist auf.

Sagt Jonny „füge Kapitel 4 einen Unterabschnitt 4.4 hinzu“, liest der Agent die berechneten Nummern aus `get_project` und legt den Knoten über `edit_outline` an. Jonny kann jedes Feld in der Planansicht oder direkt in der YAML-Datei ändern und muss keines selbst ausfüllen.

### Ordner

```
projects/phd-proposal/
  project.md                      Projektbrief
  insights.md                     Einsichten ohne festen Ort
  plans/
    proposal/
      plan.md                     Planungsdokument
      outline.yaml                Gliederung
      nodes/kommunikationsbegriff.md
      nodes/autopoiesis.md        Abschnitt mit Quellen, deshalb eigenes Dokument
    paper-plattformen/
      plan.md
      outline.yaml
  proposals/p_01JC4M7R2X.json     Vorschläge ungefragter Agent-Änderungen
```

Ein Projekt kann mehrere Pläne haben (D13). Beim Anlegen stehen die Vorlagen „Exposé“ und „IMRaD“ bereit, die `outline.yaml` mit Knoten und Zweck füllen (D14).

## 5. Änderungen durch den Agent

- **Im Chat erbetene Änderungen schreibt der Agent direkt.** Sagt Jonny „so will ich das, formuliere das mal aus“, steht der Text sofort im Dokument.
- **Jede Änderung lässt sich zurücknehmen.** Der Kern legt vor jedem Schreiben die vorige Fassung im Verlauf der Datei ab, mit Akteur und Agent-Zug. „Rückgängig“ stellt alle Dateien eines Zugs wieder her. Hat Jonny dazwischen selbst geändert, führt der Kern beide Stände per Drei-Wege-Merge zusammen und zeigt Konflikte an. Der Verlauf liegt rechnerlokal unter Application Support, geräteübergreifend hilft git (A9).
- **Der Prüfmodus ist wählbar.** Pro Projekt (`agent_edits: review`) oder pro Chat kommen Änderungen als Vorschlag mit Diff.
- **Ungefragte Änderungen kommen als Vorschlag.** Das gilt für Hintergrundjobs und für externe Agents außerhalb eines citegeist-Chats.

## 6. Verträge

- `insights.note` (write, MCP `note_insight`): `project`, `plan?`, `target` (Knoten-ID, `plan` oder `project`), `text`. Der Kern setzt Datum und Block-ID. Ausgabe `path`, `block`, `number` des Knotens.
- `insights.find` (read, MCP `find_insights`): `project`, `plan?`, `node?`, `refs?`, `query?`, `limit = 5`. Ausgabe Absätze mit `path`, `block`, `date`, `text`, `stage` (`links` oder `semantic`) und `why`.
- `plans.create` (write): `project`, `slug`, `title`, `template?: "expose" | "imrad"`. `plans.list` (read): `project`.
- `outline.get` (read, MCP über `get_project`, das Projekt, Pläne und Gliederung in einem Aufruf liefert): `project`, `plan`. Ausgabe Knoten mit Feldern, berechneter Nummer und Pfad des Dokuments.
- `outline.apply` (write, MCP `edit_outline`): `project`, `plan`, `ops` aus `add` (`parent`, `position`, `title`, `purpose?`), `update` (`id`, Felder), `move` (`id`, `parent`, `position`) und `remove` (`id`). Ein Aufruf ist atomar und ein Schritt im Verlauf. `remove` eines Knotens mit Dokument oder eingehenden Links meldet diese und verlangt `force`.
- `plan.docs.update` (write, MCP `edit_plan_doc`): `project`, `plan`, `doc`, `baseHash`, `body`. Legt bei Bedarf das Dokument eines Knotens an.
- `history.list`, `history.restore`, `history.revertTurn` (write): Verlauf einer Datei, eine Fassung wiederherstellen, einen Agent-Zug zurücknehmen.
- `proposals.list`, `proposals.decide` (write): Vorschläge einsehen, annehmen oder verwerfen.

Akteur, Chat-Zug und Prüfmodus entscheiden bei jeder schreibenden Operation, ob sie direkt schreibt oder einen Vorschlag anlegt.

Schema in `packages/schema/src/plan.ts`: `PlanSlug`, `OutlineNodeId`, `OutlineNode`, `Outline`, `PlanFrontmatter` (`title`, `template?`, `created`), `NodeDocFrontmatter` (`node`, `aliases`), `Proposal`, `HistoryEntry`. `ProjectFrontmatter` bekommt `agent_edits` mit Standard `direct`. `library-format.md` bekommt Zeilen für `insights.md`, `plans/` und `proposals/` sowie die Regel für Einsicht-Absätze.

## 7. Oberfläche

- **Chat-Seitenleiste:** Bestätigungszeile nach dem Festhalten, zitierte Einsichten als Chips mit Datum, „Rückgängig“ an jedem Agent-Zug mit Änderungen.
- **Planansicht:** ein Tab pro Plan. Links steht die Gliederung mit berechneten Nummern, darüber „Planungsdokument“ und darunter „Einsichten des Projekts“. In der Mitte steht das Dokument des gewählten Knotens im Editor aus W3.1, darüber ein kleines Formular für Titel, Zweck, Status und Forschungsfragen.
- **Verlauf:** pro Datei eine Liste der Fassungen mit Herkunft.

Die Literaturmatrix (W4.4) filtert auf die Quellen, die das Dokument eines Knotens verlinkt. Der spätere Schreibtisch übernimmt die Gliederung.

## 8. Vorbilder

- **Obsidian Longform:** Die Reihenfolge steht in einer Indexdatei getrennt von den Texten. citegeist übernimmt die Trennung mit `outline.yaml` ([Scene Subtree Mover](https://community.obsidian.md/plugins/scene-subtree-mover)).
- **STORM:** Die Gliederung entsteht aus Fragen, bevor Text entsteht. Der Planungs-Agent fragt ebenso zuerst nach ([Stanford](https://storm-project.stanford.edu/research/storm/)).
- **Jenni AI:** Es setzt Zitate aus einer fremden Datenbank ein. citegeist belegt mit eigenen Karten und Einsichten (Grundsatz 3) ([eesel](https://www.eesel.ai/blog/jenni-ai-writing-tool)).

## 9. Einordnung

Die Arbeit gehört in Welle 3. Die Steckbriefe W3.7 bis W3.9 stehen in `development-plan.md`. Vorher liefert die Lead-Session `plan.ts` und die Verträge aus Abschnitt 6.

Der erste Schnitt umfasst W3.7 und das Festhalten aus W3.9: `note_insight` mit den drei Orten, die Absatzzerlegung im Index, `find_insights` mit der Link-Stufe und Verlauf mit „Rückgängig“. Bis die Seitenleiste aus W3.3 steht, läuft derselbe Ablauf mit Claude Code über MCP. Danach folgen die Gliederung, das Zurückholen im Planungs-Chat und die Planansicht.

## 10. Offene Fragen an Jonny

1. **Wie lange bewahrt der Verlauf Fassungen auf?** Empfehlung: 90 Tage für alle Fassungen, danach eine pro Tag.
2. **Soll der Agent Einsichten auch beim Lesen zurückholen, etwa beim Öffnen von Quelle B?** Empfehlung: zuerst nur im Planungs-Chat, später als leiser Hinweis im Reader.
