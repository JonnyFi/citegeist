# Lizenzen

Stand: 2026-10-24. Grundlage ist Entscheidung D1 (citegeist bleibt Open-Source-fähig). Das hier ist eine technische Bestandsaufnahme, kein Rechtsrat. Die Namensnennungen stehen in der Datei `NOTICE` im Wurzelverzeichnis. Eine `LICENSE`-Datei gibt es bewusst noch nicht, die Wahl trifft Jonny.

## Empfehlung für den Kern

Der Kern sollte unter **Apache-2.0** stehen. Der Grund: Apache-2.0 enthält eine ausdrückliche Patentlizenz und einen NOTICE-Mechanismus, und genau diesen Mechanismus braucht citegeist für die Namensnennungen von CSL, citeproc-js und den Schriften. MIT wäre ebenfalls verträglich mit allen unten genannten Komponenten.

## Wie geprüft wurde

| Bereich | Befehl oder Quelle | Umfang |
|---|---|---|
| JavaScript, Laufzeit | `pnpm licenses list --prod --json` | 306 Pakete |
| JavaScript, alles inklusive Build-Werkzeugen | `pnpm licenses list --json` | 23 verschiedene Lizenzangaben |
| Python | `uv run --with pip-licenses pip-licenses` im Worker | 125 Pakete |
| Modelle | Lizenzfeld der Hugging-Face-Seite (API) und die Modellkarte | 5 Repositories |
| Mitgelieferte Daten | `packages/cite/src/vendor/NOTICE.txt` und die `<rights>`-Elemente der Dateien | 5 Dateien |
| Schwachstellen | `pnpm audit`, `pip-audit` | keine Treffer, siehe `docs/security.md` |

Verteilung der Laufzeit-Abhängigkeiten in JavaScript: MIT 245, Apache-2.0 19, BSD-3-Clause 15, ISC 13, OFL-1.1 3, BSD-2-Clause 1, CC0-1.0 1, Unlicense 2, MIT oder Apache 2, MIT oder CC0 1, CPAL-1.0 oder AGPL 1, LGPL-3.0-or-later 1, ohne Angabe 2.

Verteilung in Python (einschließlich der Dev-Gruppe und des Worker-Pakets selbst): MIT 67, BSD-Familie 29, Apache-2.0 15, MPL-2.0 2, Sonstige 12 (PSF, ISC, HPND, Mehrfachlizenzen, Zusammensetzungen gebündelter Bibliotheken).

## Was auffällt

Keine Komponente steht unter GPL oder AGPL und läuft im Prozess von citegeist. Auffällig sind die folgenden Punkte.

| Nr. | Komponente | Lizenz | Wirkung | Isolierung oder Namensnennung | Offene Aktion |
|---|---|---|---|---|---|
| 1 | `citeproc` (citeproc-js) 2.4.63, über `@citation-js/plugin-csl` | CPAL-1.0 oder AGPL (Doppellizenz) | CPAL ist Copyleft auf Dateiebene mit Namensnennung. AGPL wäre für den Kern unverträglich | citegeist nutzt die CPAL-Option, unverändert, als npm-Paket. Das mitgelieferte `LICENSE` nennt keinen Exhibit-B-Text, es gibt also keinen festen Anzeigetext. Der Lizenztext liegt im Paket und steht in `NOTICE` | Vor 1.0 prüfen, ob die CPAL-Regel zur Netzwerknutzung ein späteres gehostetes Angebot betrifft (ungeprüft). Fallback ist hayagriva (Apache-2.0) |
| 2 | `@anthropic-ai/claude-agent-sdk` 0.3.309 | proprietär ("SEE LICENSE IN README", Anthropic Legal Agreements) | Keine Open-Source-Lizenz. Kommt als Abhängigkeit von `@agentclientprotocol/claude-agent-acp` (Apache-2.0) ins Paket | `electron-builder.yml` schließt nur die nativen Binaries aus. Das JavaScript des SDK bleibt in der App | **Blocker für eine verteilte App**, nicht für den Quelltext. Vor dem Binär-Release klären, ob Anthropic die Weitergabe erlaubt, oder das SDK beim ersten Start installieren statt mitliefern |
| 3 | EmbeddingGemma 300M (`onnx-community/embeddinggemma-300m-ONNX`) | Gemma Terms of Use und Prohibited Use Policy | Keine OSI-Lizenz. Nutzungsbeschränkungen müssen an Dritte weitergegeben werden | Die Gewichte liegen nicht im Repository. Sie werden zur Laufzeit von Hugging Face geladen (fester Commit). Es ist aktuell das Standardmodell (`DEFAULT_MODEL` in `packages/embed/src/models.ts`) | Für den Release entweder Qwen3-Embedding-0.6B als Standard setzen (Apache-2.0) oder vor dem ersten Download einen Hinweis mit Link auf die Gemma-Bedingungen zeigen |
| 4 | CSL-Stile und -Locales (3 Stile, 2 Locales) | CC BY-SA 3.0 | Namensnennung. Bearbeitete Stile müssen unter derselben Lizenz stehen | Die Dateien liegen unverändert und getrennt vom Code in `packages/cite/src/vendor`. Kopfzeilen mit Autoren bleiben erhalten. `NOTICE` nennt Quelle und Autoren | Keine, solange kein Stil geändert wird. Ein geänderter Stil bekommt CC BY-SA und eine eigene Zeile in `NOTICE` |
| 5 | `@img/sharp-libvips-darwin-arm64` 1.3.4 (libvips, über sharp, optional für Transformers.js) | LGPL-3.0-or-later | LGPL verlangt Lizenztext, Quellhinweis und die Möglichkeit, die Bibliothek auszutauschen | Dynamisch geladene Bibliothek, unverändert. `electron-builder.yml` entfernt nur die Varianten für Linux, Windows und Intel | Prüfen, ob `sharp` im gebauten Bundle überhaupt gebraucht wird. Für Text-Embeddings ist es nicht nötig, der Ausschluss würde die LGPL-Pflicht entfallen lassen |
| 6 | Schriften Inter, JetBrains Mono, Newsreader | OFL-1.1 | Lizenztext und Copyright-Zeile müssen bei den Schriftdateien bleiben. Der Name darf bei Änderungen nicht weiterverwendet werden | Unveränderte Pakete von Fontsource, Hinweis in `NOTICE` | Beim Bundlen die Lizenzdateien der drei Pakete mit ausliefern |
| 7 | `certifi` 2026.10.23 (Python) und `lightningcss` (nur beim Bauen) | MPL-2.0 | Copyleft auf Dateiebene | Unveränderte Pakete, `lightningcss` läuft nur beim Bauen | Keine |
| 8 | `tld` 0.13.2 (Python, über trafilatura) | MPL-1.1 oder GPL-2.0 oder LGPL-2.1+ | Wahlrecht | Wir wählen MPL-1.1, unverändert, Installation auf dem Rechner des Nutzers | Keine |
| 9 | Temurin-JRE 21 für GROBID | GPL-2.0 mit Classpath Exception | Die Ausnahme erlaubt die Nutzung durch Programme beliebiger Lizenz | Wird zur Laufzeit geladen (Prüfsumme fest), läuft als eigener Prozess hinter 127.0.0.1 | Keine |
| 10 | GROBID | Apache-2.0 | Unkritisch | Wird zur Laufzeit aus dem Release-Archiv gebaut (Prüfsumme fest), eigener Prozess | Keine |
| 11 | `opencv-python-headless`, `torch`, `numpy`, `pypdfium2` (Python) | Apache-2.0, BSD, gebündelte Fremdbibliotheken | Die Wheels bündeln eigene native Bibliotheken. Bei OpenCV sind das laut Projekt teils LGPL-Teile wie FFmpeg (ungeprüft) | Der Worker installiert sie beim ersten Start per `uv` von PyPI auf den Rechner des Nutzers. citegeist gibt sie nicht weiter, nur den Quelltext des Workers | Keine, solange die App die Wheels nicht selbst mitliefert |
| 12 | Fixture-Daten und Spike-Ausgaben | CC BY 4.0, CC BY-SA 4.0, gemeinfrei, bei drei Dateien ungeklärt | `fixtures/pdf/manifest.json` führt je Datei Lizenz und Beleg. Drei Einträge tragen den Vermerk, die Lizenz vor einer Weitergabe zu prüfen. `spikes/s1/out` enthält extrahierten Volltext dieser Dokumente | Die PDFs liegen nicht im Repository (`fetch.mjs` lädt sie mit Prüfsumme) | Vor dem Release `spikes/*/out` aus dem Repository nehmen oder auf klar lizenzierte Quellen beschränken |

## Zotero und AGPL

D1 verlangt, dass AGPL-Komponenten als eigener Prozess laufen. Im Code ist dieser Fall gar nicht eingetreten, denn citegeist enthält und startet keine Zotero-Komponente.

| Zotero-Teil | Lizenz | Stand in citegeist |
|---|---|---|
| translation-server, translators, reader, note-editor | AGPL-3.0 und gemischt | Nicht enthalten, nicht gestartet. Die Suche im Code findet keinen Verweis |
| Connector-Protokoll (Port 23119) | Schnittstelle | Neu geschrieben in `packages/server/src/connector`. Die Übersetzer laufen in der Browser-Erweiterung des Nutzers (`getTranslators` antwortet mit 501) |
| zotero-schema | keine Lizenzdatei | Keine Datei übernommen. `packages/import/src/zotero/mapping.ts` enthält eigene Tabellen mit denselben Tatsachen (Typnamen, Feldzuordnung) |
| Online-Dienste (api.zotero.org, services.zotero.org) | Nutzungsbedingungen Abschnitt 6 | Im Code nicht angesprochen. Der Zotero-Import liest die lokale API auf 127.0.0.1 |
| Name "Zotero" | eingetragene Marke | Nur beschreibend benutzt ("Zotero Connector"), nicht im Produktnamen |

Wer später Zoteros translation-server anbindet, startet ihn als eigenen Prozess oder Container hinter einer lokalen HTTP-Schnittstelle und lässt den Nutzer ihn installieren.

## Modelle und Laufzeit-Downloads

| Modell oder Programm | Lizenz | Herkunft | Wann |
|---|---|---|---|
| docling-project/docling-layout-heron | Apache-2.0 | Hugging Face, fester Commit | `download-models` oder erster Import |
| docling-project/docling-models | CDLA-Permissive-2.0 und Apache-2.0 | Hugging Face, fester Commit | wie oben |
| docling-project/CodeFormulaV2 | CDLA-Permissive-2.0 | Hugging Face, fester Commit | bei Formelseiten |
| Qwen3-Embedding-0.6B (ONNX) | Apache-2.0 laut Ursprungsmodell, die ONNX-Karte trägt kein Lizenzfeld | Hugging Face, fester Commit | Einstellung Semantische Suche |
| EmbeddingGemma 300M (ONNX) | Gemma Terms of Use | Hugging Face, fester Commit | Standard der Semantischen Suche |
| GROBID und Temurin-JRE | Apache-2.0, GPL-2.0 mit Classpath Exception | GitHub, Prüfsumme im Code | `install-grobid` |
| Apple Vision (OCR) | Teil von macOS | System | Scans |

Die Qwen3-Lizenz sollte vor dem Release gegen die Modellkarte des Ursprungsmodells `Qwen/Qwen3-Embedding-0.6B` geprüft werden, weil die ONNX-Karte keine Angabe macht.

## Agenten-CLIs

Claude Code, Codex und Cursor installiert der Nutzer selbst und meldet sich selbst an (D1). citegeist ruft sie nur auf. Die Adapter `claude-agent-acp` und `codex-acp` stehen unter Apache-2.0. Das Codex-Binary (`@openai/codex`, Apache-2.0) und das Claude-Code-Binary sind aus dem App-Paket ausgeschlossen. Offen bleibt allein das JavaScript des Claude Agent SDK, siehe Punkt 2.

## Pflichten beim Release

1. `LICENSE` anlegen (Apache-2.0 empfohlen) und `NOTICE` im Wurzelverzeichnis und im App-Paket mitliefern.
2. Punkt 2 klären (Claude Agent SDK) oder das SDK aus dem Paket nehmen.
3. Punkt 3 entscheiden (Standardmodell der Semantischen Suche).
4. Lizenzdateien der drei Schriftpakete und von citeproc im App-Paket belassen. Electron liefert `LICENSES.chromium.html` mit, `afterPack` darf sie nicht löschen.
5. `spikes/*/out` aus dem Repository nehmen.
6. Bei jeder neuen Abhängigkeit `pnpm licenses list --prod` und die Python-Liste erneut prüfen. Neu auftauchende GPL-, AGPL- oder SSPL-Pakete stoppen den Release.
