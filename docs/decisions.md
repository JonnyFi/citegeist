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

## D15: Eine Karte trägt genau einen AI-Text, die Paraphrase

Datum: 2026-10-24. Status: entschieden.

Die Kernaussage entfällt in der Aufgabe `card.paraphrase`, in der Oberfläche und bei neuen Karten. Die Paraphrase umfasst einen bis drei Sätze in der aufgelösten Sprache (D9). Alte Karten bleiben lesbar: Ein gespeicherter Abschnitt „Core statement“ und der Stempel `core` bleiben beim Umschreiben der Datei erhalten, die Oberfläche zeigt sie nirgends, die Suche liest sie nicht, und sie wandern in kein anderes Feld. Das Neuschreiben und die Sprachwahl sitzen als kleine Aktion im Paraphrase-Block der Karte. Modell, Zeit und Sprache stehen in einem kleinen Tooltip statt in einer sichtbaren Zeile.

## D16: Die Art einer Karte ist optional, und die AI schlägt sie vor

Datum: 2026-10-24. Status: entschieden.

Die Art „Zitat“ entfällt, weil jede Karte ein Zitat enthält. Die Arten sind These, Befund, Methode, Definition, Beispiel und Kritik (`thesis`, `finding`, `method`, `definition`, `example`, `critique`). Dieselbe Anfrage, die die Paraphrase schreibt, ordnet die Karte einer Art zu, und der Nutzer ändert die Art jederzeit. Eine vom Nutzer gesetzte Art bleibt beim Neuschreiben der Paraphrase stehen. Alte Karten werden beim Lesen abgebildet: `quote` und `comment` werden zu keiner Art, die übrigen Arten bleiben unverändert. Das Feld `kind` ist im Schema optional, und eine Karte ohne Art trägt die neutrale Kartenfarbe.

## D17: Ein freies Feld „Notiz“ ersetzt „In meinen Worten“ und „Kommentar“

Datum: 2026-10-24. Status: entschieden.

Der Abschnitt heißt im Dateikörper `## Note`. Alte Karten mit beiden Abschnitten werden beim Lesen zusammengeführt: eigene Worte, eine Leerzeile, dann der Kommentar. Die Datei ändert sich erst, wenn die Karte neu geschrieben wird. Die Exportregel `own-else-ai` nimmt für sinngemäße Zitate die Notiz, sofern es eine gibt, sonst die Paraphrase. Die Kopieraktionen der Karte heißen „Wörtlich zitieren“ (Zitat mit Beleg) und „Sinngemäß zitieren“ („vgl.“-Beleg mit Paraphrase oder Notiz).

## D18: Ein Begriff ist eine Notiz vom Typ concept, und jeder Eintrag pro Quelle ist belegt

Datum: 2026-10-24. Status: entschieden.

Das Begriffsregister liegt als Markdown unter `notes/concepts/<slug>.md`, Obsidian-kompatibel, mit `type: concept` und den Namen des Begriffs unter `aliases`. Der Ordner trennt Begriffe von Zetteln, die Wiki-Links lösen weiter über den Dateinamen auf, und ein Begriffsname ist deshalb nie zugleich der Name einer Notiz. Im Frontmatter stehen außerdem die Karten des Begriffs (`cards`) und pro Quelle ein Eintrag (`usages`). Der Körper der Datei ist daraus abgeleitet: der eigene Text des Nutzers, dann ein markierter Block mit einem Abschnitt `## [[citekey]]` pro Quelle, Belegzitaten und `[[c_…]]`-Links auf die Karten. Der Block wird bei jedem Schreiben neu erzeugt.

Namen gelten als gleich, wenn sie sich nur in Groß- und Kleinschreibung, Akzenten, Umlautschreibung (ä oder ae) oder Satzzeichen unterscheiden. Ein neuer Begriff, dessen Name oder Alias schon zu einem Begriff gehört, erweitert diesen. Gehören die Namen zu zwei verschiedenen Begriffen, bricht das Anlegen mit dem Hinweis auf `concepts.merge` ab. Beim Zusammenführen werden Titel und Aliase der anderen Begriffe zu Aliasen des Ziels, die Karten vereinigt, Links auf die anderen Begriffe umgeschrieben und deren Dateien entfernt. Beim Umbenennen bleibt der alte Titel als Alias stehen.

Ein Eintrag entsteht in der Aufgabe `concept.describe`. Sie sieht nur die Zitate der Karten dieser Quelle, die dem Begriff zugeordnet sind, und schreibt in der Bibliothekssprache (D9). Jedes Belegzitat wird gegen den gespeicherten Kartentext geprüft (dieselbe Normalisierung wie bei der Literaturmatrix), gespeichert wird der Text der Karte, und die Seite stammt aus der Karte. Bleibt kein Zitat übrig, wird der Eintrag verworfen. Jeder Eintrag merkt sich die Karten, aus denen er entstand. Ändert sich die Kartenmenge der Quelle, gilt er als veraltet und wird beim nächsten Lauf neu geschrieben.

Vorschläge kommen aus Karten der Art Definition (die Aufgabe `concept.name` nennt den definierten Begriff, und er muss im Zitat oder in der Paraphrase vorkommen) und aus Wörtern, die in mindestens zwei Quellen wiederkehren (ohne Modell, aus Karten und Notizen gezählt). Nichts davon wird ohne Zutun des Nutzers angelegt.

Die MCP-Obergrenze von 20 Werkzeugen ist ausgeschöpft. Agents erreichen die Begriffe deshalb über die Befehle `cg concepts …`, die aus denselben Verträgen entstehen, und in der Chat-Seitenleiste über deren Shell (A11).

## D19: Die Literatursuche der research-pipeline wird Teil von citegeist

Datum: 2026-10-24. Status: entschieden (Issue #50).

Die Skripte der research-pipeline liegen als `workers/research` im Repo, nur mit der Python-Standardbibliothek, und laufen mit uv in einer eigenen Umgebung unter dem maschinenlokalen Ordner. Der Webserver und die Weboberfläche der Pipeline kommen nicht mit: core startet `pipeline.py` für jeden Lauf als Job und schreibt `run.json`, die Oberfläche ist ein Reiter „Literatursuche“ über die Operationen `litsearch.*`. Läufe und Preprint-Listen liegen pro Bibliothek unter `research/`; Suchcache, OpenAlex-Datensätze und Log eines Laufs stehen in der Ignore-Liste. Wo citegeist eine Funktion schon hat, gilt die citegeist-Fassung: Funde gehen wie die Kandidaten des Zitationsgraphen in die Inbox (D7), die Literaturmatrix und die Rückruf-Warnungen sind die von citegeist, die Leseliste der Pipeline entfällt, ebenso scite. Suchvorschläge laufen über das eingestellte Modell. Der OpenAlex-Schlüssel liegt im Schlüsselbund im Fach `openalex`. Eine Suche, die sich wiederholen soll, ist ein Alert der Art „Pipeline-Suche“ und steht in der Liste der Alerts neben den übrigen Arten. Er speichert Thema, Suchanfragen und Optionen und entsteht im Lauf über „Als Alert speichern“. Jede Prüfung startet über denselben Dienst einen Lauf `litsearch.run` und vergleicht ihn mit dem vorigen Lauf des Alerts, beim ersten Mal mit dem Lauf, aus dem der Alert gespeichert wurde. Die neuen Paper, die weder in der Bibliothek noch in der Inbox stehen und dem Alert noch nie vorgeschlagen wurden, kommen nach Score geordnet in die Inbox, als Absender „system“ mit „Alert: <Name>, Score <x>, Lauf <id>“ (D7). Die Bewertung der Pipeline bestimmt die Reihenfolge. Den Zeitpunkt bestimmt der Zeitgeber der Alerts, solange die App offen ist. Voreinstellung ist eine Woche, weil ein Lauf teuer ist, und es läuft immer nur eine Suche. Beobachtungen und ihr Hintergrundauftrag (launchd) entfallen. Beobachtungen aus älteren Bibliotheken (`research/watches/watchlists.json`) wandelt die App beim Start einmal in Alerts um und benennt die Datei in `watchlists.json.migrated` um: war der Hintergrundlauf an, ist der Alert aktiv, sonst pausiert. Ob ein verfolgter Preprint erschienen ist, entscheidet allein die Versionserkennung des Graphen (`graph/versions.ts`). Liegen Preprint und Artikel in der Bibliothek, steht die Verknüpfung als `versions`-Eintrag im Graphen und der Reiter „Preprints“ liest sie von dort. Für alle übrigen Preprints hält `research/watches/preprint-checks.json` das Ergebnis derselben Abfrage, weil der Graph dafür keinen Eintrag hat. `preprints.py` führt nur die Liste der verfolgten Preprints und den OpenReview-Stand. Die Prüfung läuft wöchentlich, solange die App offen ist.
