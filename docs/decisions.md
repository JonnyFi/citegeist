# Entscheidungen

Hier steht, was für citegeist entschieden ist. Neue Entscheidungen kommen unten dazu. Eine Entscheidung wird nie still geändert: Wer sie ändern will, schreibt eine neue, die auf die alte verweist und sagt, welcher neue Befund den Wechsel trägt.

Produktentscheidungen tragen ein D, Architekturentscheidungen ein A.

## D1: citegeist bleibt Open-Source-fähig, und jeder Nutzer bringt sein eigenes Abo mit

Datum: 2026-10-23. Status: entschieden.

citegeist entsteht zuerst als Werkzeug für Jonny und wird so gebaut, dass ein Open-Source-Release später ohne Umbau möglich ist. Komponenten unter AGPL (etwa Zoteros translation-server) laufen als eigener Prozess hinter einer lokalen HTTP-Schnittstelle. Diese Trennung kostet keine laufenden Gebühren, nur einmalig etwas Entwicklungszeit. Der Kern bekommt eine permissive Lizenz (MIT oder Apache 2.0, die Wahl ist offen).

Für die AI-Funktionen ruft citegeist die offiziellen CLIs von Claude Code, Codex oder Cursor auf, in die sich der jeweilige Nutzer selbst eingeloggt hat. Das gilt für Jonny und für alle späteren Nutzer. API-Keys (Anthropic, OpenAI, OpenRouter, xAI) und lokale Modelle sind zusätzliche Optionen, die sich pro Aufgabe wählen lassen.

## D2: In v1 kommen Zitate über Export und Rich-Text-Zwischenablage in den Text

Datum: 2026-10-23. Status: entschieden.

Jonny schreibt im Moment nichts Längeres. Später wird es vermutlich Google Docs oder eine freie Alternative zu Word. v1 liefert deshalb zwei Wege: einen Export für Pandoc, Typst und LaTeX (stabile Citekeys, automatisch aktualisierte `.bib`- und CSL-JSON-Dateien) und ein Kopieren als Rich Text, bei dem Zitat und fertig formatierter Beleg gemeinsam in der Zwischenablage landen.

Manuelles Kopieren ist auf Dauer zu umständlich. Spätere Ausbaustufen sind Add-ins (Google Docs, LibreOffice) oder ein eigener Schreibeditor in citegeist. Bis dahin soll ein Quick-Insert per globalem Hotkey die Reibung senken (siehe `product.md`).

## D3: Es gibt Importer für Zotero und für BibTeX, RIS und CSL-JSON

Datum: 2026-10-23. Status: entschieden.

Jonny nutzt aktuell keine Literaturverwaltung. Die Importer machen citegeist für spätere Nutzer brauchbar, die von Zotero, Mendeley, Paperpile, EndNote oder Citavi kommen. Sie sind deshalb für den ersten nutzbaren Stand nachrangig und eignen sich gut als unabhängige, parallele Arbeitspakete.

## D4: Die Konvertierung deckt in v1 digitale PDFs, arXiv-HTML, Web-Artikel und Scans ab

Datum: 2026-10-23. Status: entschieden.

Jonny erwartet viele PDFs. Der Großteil wissenschaftlicher PDFs hat bereits eine Textebene. Für Scans und gescannte Buchkapitel braucht es OCR, und die läuft lokal und kostenlos auf dem Mac. Graue Literatur und Web-Artikel gehören ebenfalls in v1.

## D5: Mehrere Macs teilen sich die Bibliothek über git oder einen synchronisierten Ordner

Datum: 2026-10-23. Status: entschieden.

Die Bibliothek ist ein Ordner aus Dateien. Sync und Versionierung sind zwei getrennte Aufgaben, die gleichzeitig laufen dürfen:

- **Sync:** Der Ordner kann in iCloud Drive, Dropbox oder einem anderen synchronisierten Ort liegen. Das gilt für alle Dateien inklusive PDFs.
- **Versionierung:** git liefert Verlauf und Diffs und macht Änderungen von Agents nachvollziehbar. Liegt der Ordner in iCloud, kommt das `.git`-Verzeichnis per `git init --separate-git-dir` an einen lokalen Ort außerhalb von iCloud, weil iCloud die internen git-Dateien sonst einzeln und zeitversetzt synchronisiert und das Repo beschädigen kann. Wer ohne iCloud arbeitet, kann über einen git-Remote synchronisieren, dann mit git LFS für die PDFs.

Der Suchindex und alle anderen rechnerlokalen Daten liegen außerhalb des Bibliotheksordners in `~/Library/Application Support/citegeist/` und bauen sich bei Bedarf selbst neu auf. SQLite-Dateien gehören nie in einen synchronisierten Ordner.

## D6: Notizen sind Obsidian-kompatibles Markdown

Datum: 2026-10-23. Status: entschieden.

Notizen sind Markdown-Dateien mit YAML-Frontmatter und Wiki-Links. Der Bibliotheksordner ist zugleich ein gültiger Obsidian-Vault. Typisierte Verbindungen zwischen Papern und Notizen stehen maschinenlesbar im Frontmatter. Jonny hat Obsidian früher genutzt und will die Handarbeit, die es verlangt hat, jetzt an citegeist und die Agents abgeben. Die Kompatibilität bleibt trotzdem erhalten, weil sie nichts kostet und Lock-in verhindert.

## A1 bis A8: Architektur

Datum: 2026-10-23. Status: von Jonny freigegeben. Begründungen in `architecture.md` und `docs/research/`.

- **A1:** Ein eigener Kern-Prozess (Node, TypeScript) besitzt die Bibliothek. App, CLI und MCP sind gleichrangige Clients.
- **A2:** Jede Fähigkeit ist einmal als Operation definiert und erscheint automatisch als RPC, CLI-Kommando und, kuratiert, als MCP-Tool.
- **A3:** Dateien im Bibliotheksordner sind die Wahrheit. SQLite ist ein rechnerlokaler, neu aufbaubarer Index.
- **A4:** Konvertierte Dokumente leben als Blockmodell mit stabilen IDs. HTML zum Lesen und Markdown für Agents werden daraus erzeugt.
- **A5:** Zitatkarten sind einzelne Markdown-Dateien mit doppeltem Anker (PDF und Text). Der Wortlaut bleibt unverändert, jede Paraphrase trägt ihre Herkunft. Was exportiert wird, ist eine Projekteinstellung.
- **A6:** Die Hülle ist Electron. Die Konvertierung läuft in einem Python-Worker mit uv.
- **A7:** AI läuft über eine Backend-Schnittstelle mit `complete` und `session`. Standard ist Claude Code über das Agent SDK mit vorgewärmten Prozessen. Die Chat-Seitenleiste ist ein ACP-Client.
- **A8:** Agents bekommen einen MCP-Server mit etwa zehn Tools, die CLI `cg`, einen portablen Skill im gstack-Aufbau und eine `AGENTS.md` im Bibliotheksordner.

- **A9:** Obsidian-Format, Sync und Versionierung sind drei getrennte Rollen. Das Format kostet nichts. Sync läuft über genau einen Transport, entweder iCloud/Dropbox oder einen git-Remote, nie beide gleichzeitig. git-Verlauf ist immer erlaubt, bei iCloud mit ausgelagertem `.git`. Konfliktkopien von iCloud (`Datei 2.md`) erkennt der Watcher und meldet sie.

## D7: Inhalte von Agents landen zuerst in der Inbox, mit Abkürzung über MCP

Datum: 2026-10-23. Status: entschieden (ersetzt die erste Fassung vom selben Tag).

Alles, was ein Agent hinzufügt, landet zuerst in der Inbox und trägt eine Herkunftsmarke. Das MCP-Tool `add_item` hat den Parameter `target: "library"`, mit dem ein Agent wie der Grok-Bot ein Paper direkt in die Bibliothek legt, wenn er weiß, welches gemeint ist, oder Jonny es ihm sagt. Was Jonny selbst hinzufügt, landet direkt in der Bibliothek.

## D8: Externe Agents kommen über allgemeine Webhooks

Datum: 2026-10-23. Status: entschieden.

Jonnys Agent ist Grok. Webhooks bleiben allgemein, damit auch andere Agents wie Hermes angeschlossen werden können.

## D9: Die Sprache der AI-Texte ist jederzeit per Dropdown wählbar

Datum: 2026-10-23. Status: entschieden.

Jedes Projekt hat eine Spracheinstellung. Im Reader gibt es jederzeit ein Dropdown an der gerade gelesenen Quelle, das die Projekteinstellung für diese Quelle überschreibt. Ohne Projekt gilt ein Bibliotheksstandard.

## D10: Alle Vorschläge der Feature-Landkarte sind angenommen

Datum: 2026-10-23. Status: entschieden.

Die Entwicklung läuft ohne Pause durch alle Wellen. REA wird nicht eingesetzt, weil Zoteros Quellcode offenliegt.

## A10: Der Highlighter arbeitet asynchron, Standard ist `claude -p` mit Haiku

Datum: 2026-10-23. Status: entschieden auf Basis von Spike S2 (`docs/spikes/s2-inference.md`).

Kein Abo-Pfad erreicht p50 unter 3 Sekunden. Am schnellsten war ein frischer `claude -p` mit Haiku, `--effort low` und ausgeschaltetem Denken (p50 4,2 s, p95 5,2 s). Der vorgewärmte SDK-Prozess war langsamer. Deshalb entsteht die Karte mit Wortlaut und Seite sofort, und Paraphrase und Kernaussage erscheinen ein paar Sekunden später. Neues Kriterium: Die Karte steht in unter 300 ms, die AI-Texte folgen mit p50 unter 5 Sekunden. API-Key und lokales Modell bleiben wählbar für alle, die es schneller wollen.

## D11: Ein Abschnitt bekommt erst mit Behauptungen oder Quellen eine eigene Datei

Datum: 2026-10-24. Status: entschieden.

Kapitel und Abschnitte sind Knoten der Gliederung in `outline.yaml`. Jedes Kapitel hat ein eigenes Dokument. Ein Abschnitt bekommt erst eines, wenn er Behauptungen oder Quellen trägt, bis dahin stehen seine Einsichten im Dokument des Kapitels. Grundlage ist `docs/spec/research-planning.md`.

## D12: Im Chat erbetene Änderungen schreibt der Agent direkt, mit Herkunft und Rückgängig

Datum: 2026-10-24. Status: entschieden.

Wenn Jonny im Chat sagt „so will ich das, formuliere das mal aus“, schreibt der Agent direkt ins Dokument. Jede Änderung trägt ihre Herkunft. Jede Datei hat einen Verlauf, und ein Klick nimmt einen ganzen Agent-Zug zurück. Ein Prüfmodus mit Vorschlägen lässt sich pro Projekt oder pro Chat einschalten. Änderungen, um die niemand gebeten hat, etwa aus Hintergrundjobs oder von externen Agents außerhalb eines Chats, kommen weiterhin als Vorschlag. Der Grund ist der Arbeitsfluss: Wer im Chat um einen Text bittet, will ihn sofort im Dokument sehen. Die Fassung mit Vorschlag für jede Agent-Änderung aus dem ersten Entwurf der Spec ist damit verworfen.

## D13: Ein Projekt kann mehrere Pläne haben

Datum: 2026-10-24. Status: entschieden.

Ein Projekt wie „PhD-Proposal“ kann neben dem Plan für das Proposal einen Plan für ein Paper haben. Beide nutzen dieselben Quellen, Karten und Einsichten. Pläne liegen unter `projects/<slug>/plans/<plan>/`.

## D14: Beim Anlegen eines Plans stehen die Vorlagen Exposé und IMRaD bereit

Datum: 2026-10-24. Status: entschieden.

Die ersten Vorlagen sind ein Exposé für das PhD-Proposal und IMRaD für Paper. Weitere Textsorten kommen später als Vorlagendateien dazu.

## A11: Chat-Agents arbeiten standardmäßig in der Umgebung des Nutzers

Datum: 2026-10-24. Status: entschieden. Ersetzt für Chat-Sitzungen die Isolationsregel im Abschnitt „AI-Schicht" der Architektur (`settingSources: []`, keine Shell, nur die citegeist-Werkzeuge).

Anlass ist die erste echte Chat-Sitzung (Issues #34 bis #39). Der Agent konnte eine PDF nicht herunterladen, kein Issue anlegen und `cg` nicht aufrufen, weil seine Sitzung ohne Shell, ohne die MCP-Server des Nutzers und ohne dessen Claude-Code-Einstellungen lief. Die Isolation hatte den Zweck, dass eine Sitzung nicht die persönliche Konfiguration des Nutzers mitlädt. Im Chat sitzt der Nutzer aber selbst am Bildschirm und will genau diese Konfiguration.

Eine Chat-Sitzung bekommt deshalb dieselbe Umgebung wie das Claude Code des Nutzers. Beim Claude-Adapter laden `settingSources` `user` und `project`. Damit kommen die MCP-Server und Einstellungen des Nutzers in die Sitzung, die Shell ist erlaubt, und der citegeist-MCP-Server wird pro Sitzung dazugegeben. Codex arbeitet mit der Codex-Konfiguration des Nutzers. Die Berechtigungsregel der Chat-Seitenleiste lässt Shell, fremde Werkzeuge und Änderungen außerhalb des Bibliotheksordners zu. Im Bibliotheksordner bleiben abgeleitete Daten, konvertierte Originale und das Manifest geschützt.

Die Einstellung „Isolierter Agent" (Einstellungen, Abschnitt Chat-Agent) stellt die bisherige Sandbox wieder her: keine Shell, keine Nutzereinstellungen, nur die citegeist-Werkzeuge. Eine Änderung gilt ab dem nächsten Beitrag in einer laufenden Sitzung, der Agent wird dann neu gestartet und neu eingewiesen.

Isoliert bleiben Recherche-Aufträge und die Inferenz-Aufgaben (Highlighter, Metadaten, Zusammenfassungen). Beide laufen ohne Gespräch und ohne dass jemand zusieht, deshalb bleibt es bei `settingSources: []`, ohne Shell und mit Schreibzugriff allein über `add_item` in die Inbox.

Die Folgen für die Nachvollziehbarkeit sind gering. Der Verlauf eines Zuges (D12) vergleicht den Bibliotheksordner vor und nach dem Zug und erfasst deshalb auch Änderungen, die eine Shell-Anweisung ausgelöst hat. Was der Agent über MCP anlegt, trägt weiter `by: agent:<name>` (D7).
