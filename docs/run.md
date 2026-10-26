# citegeist starten

## Voraussetzungen

- macOS auf Apple Silicon, Node 22 und pnpm 10.
- `uv` für die Python-Umgebung der Konvertierung (`brew install uv`).
- Für den Chat die offiziellen CLIs, mit denen du dich anmeldest: `claude auth login` für Claude Code, `codex login` für Codex. Die ACP-Adapter liefert citegeist selbst mit.

## Dev-App

```
pnpm install
pnpm --filter @citegeist/ui dev
ELECTRON_RENDERER_URL=http://localhost:5173 pnpm --filter @citegeist/desktop dev
```

Der erste Befehl startet den Vite-Server der Oberfläche, der zweite Electron mit Hot Reload für Main-Prozess und Kern. Ohne `ELECTRON_RENDERER_URL` lädt Electron die gebaute Oberfläche aus `apps/ui/dist` (vorher `pnpm --filter @citegeist/ui build`). Die Bibliothek wählst du im Willkommensfenster. Eine bestimmte Bibliothek öffnest du direkt mit `CITEGEIST_LIBRARY=/Pfad/zur/Bibliothek`.

Weitere Schalter für Entwicklung und Tests:

| Variable | Wirkung |
|---|---|
| `CITEGEIST_LOCAL_BASE` | Ordner für Index und Sperrdatei, Standard `~/Library/Application Support/citegeist` |
| `CITEGEIST_USER_DATA` | Electron-Datenordner, trennt Einstellungen und Einzelinstanz-Sperre |
| `CITEGEIST_WORKER_DIR` | Quellordner des Python-Workers, Standard `workers/convert` im Repo |
| `CITEGEIST_AI_MOCK=1` | Alle AI-Aufgaben antworten mit festen Texten |

Die Ende-zu-Ende-Tests laufen mit `pnpm --filter @citegeist/desktop test:e2e`.

## Gebaute App

```
pnpm package
open apps/desktop/dist/mac-arm64/citegeist.app
```

`pnpm package` baut die Oberfläche und die Electron-Bündel und schreibt danach `citegeist.app` für arm64. Die App ist nicht notarisiert und ad hoc signiert. Auf dem Rechner, auf dem sie gebaut wurde, startet sie ohne Rückfrage. Auf einem anderen Mac sperrt Gatekeeper sie, bis du sie über Rechtsklick und Öffnen freigibst. Der Abschnitt "Installation ohne Developer ID" zeigt den Weg, der Gatekeeper gar nicht erst auslöst.

Im Paket liegen die Quellen des Python-Workers (`Contents/Resources/workers/convert`), die CSL-Stile, die nativen Module und die beiden ACP-Adapter als JavaScript. Die Programme von Claude Code und Codex gehören nicht dazu. Im Chat und für die AI-Aufgaben startet citegeist das `claude` und das `codex`, das du selbst installiert hast. Es sucht im PATH und unter `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin` und ähnlichen Orten. Ein npm-Skript funktioniert, sobald ein `node` in einem dieser Ordner liegt. Fehlt das Programm, zeigen Einrichtung und Einstellungen den Installationsbefehl (`npm install -g @anthropic-ai/claude-code`, `npm install -g @openai/codex`) und den Anmeldebefehl (`claude auth login`, `codex login`), und der Chat antwortet mit demselben Fehler (`CHAT_CLI_MISSING`).

Ob der Kern läuft, zeigt der Health-Aufruf. Port und Token stehen in der Sperrdatei der Bibliothek:

```
DIR=~/Library/Application\ Support/citegeist/<Bibliothek-Id>
curl -H "authorization: Bearer $(cat $DIR/core.token)" http://127.0.0.1:$(jq .port $DIR/core.lock)/health
```

## App aktualisieren

In jedem Checkout oder Worktree:

```
pnpm app:update
```

Der Befehl holt den neuesten Stand von `main`, baut die App, beendet die laufende citegeist-App, ersetzt `/Applications/citegeist.app` und startet sie neu. Deine Bibliothek und die Einstellungen bleiben dabei unberührt, weil sie außerhalb der App liegen. Ist `main` in einem anderen Worktree ausgecheckt (etwa im Haupt-Checkout), läuft das Update dort, und der Worktree mit `main` muss bis auf untracked Dateien sauber sein.

## Feste Signatur

Ohne weiteres Zutun ist die App ad hoc signiert. macOS bindet die Bedienungshilfen-Berechtigung (für das Einfügen per Quick-Insert) bei solchen Apps an den einzelnen Build, nach jedem `pnpm app:update` ist sie deshalb weg. Mit einer eigenen, selbst signierten Identität bleibt die Signatur über alle Builds gleich, und macOS behält die Berechtigung.

```
sh scripts/make-signing-cert.sh
```

Das Skript legt einmal die Identität „citegeist local signing“ im Anmelde-Schlüsselbund an. macOS fragt dabei nach deinem Anmeldekennwort, um dem Zertifikat zu vertrauen. `pnpm package` signiert danach mit ihr, ohne Identität wie bisher ad hoc (`CITEGEIST_SIGNING_IDENTITY=-` erzwingt ad hoc). Beim ersten Build fragt macOS einmal, ob `codesign` den Schlüssel verwenden darf: Kennwort eingeben und „Immer erlauben“ wählen, nicht „Erlauben“, sonst kommt die Frage für jede Datei der App neu. Danach gibst du die Bedienungshilfen ein letztes Mal frei.

Die Identität ist keine Developer ID und verlässt den Schlüsselbund nicht. Gatekeeper prüft eine per `curl` installierte App weiterhin nicht. Wer Releases installiert, die du mit dieser Identität baust, behält die Berechtigung ebenfalls über Updates hinweg.

## Installation ohne Developer ID

citegeist ist ad hoc signiert und nicht notarisiert. Eine Datei, die `curl` herunterlädt, bekommt kein `com.apple.quarantine`-Attribut, und Gatekeeper prüft sie deshalb nicht. Darauf beruht die Installation, die ohne Apple Developer ID auskommt:

```
curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh
```

Das Skript `install.sh` macht Folgendes:

1. Es prüft macOS auf Apple Silicon und liest über die GitHub-API (`/releases/latest`) das neueste Release.
2. Es lädt `citegeist-<Version>-arm64.zip` mit `curl` und vergleicht die Prüfsumme mit der Datei `.sha256` des Releases. Bei einer Abweichung bricht es ab, ohne etwas zu installieren.
3. Es beendet ein laufendes citegeist, ersetzt `/Applications/citegeist.app` (ohne Schreibrecht dort `~/Applications/citegeist.app`) und startet die App.
4. Es legt `~/.local/bin/cg` als Symlink auf `Contents/Resources/bin/cg` in der App an. Das ist die Kommandozeile `cg`, mit der lokale Agents über `cg mcp` an citegeist kommen. Das Verzeichnis wird bei Bedarf angelegt. Ein vorhandenes `cg`, das nicht von citegeist stammt, bleibt unangetastet, und das Skript sagt es. Liegt `~/.local/bin` nicht im PATH, nennt es die Zeile für `~/.zshrc`.
5. Es prüft `uv` und mindestens eine der CLIs `claude`, `codex` und `cursor-agent` und nennt für Fehlendes den Installationsbefehl. Es installiert davon nichts.

Bibliothek und Einstellungen liegen außerhalb der App und bleiben bei einem Update erhalten. Entfernen lässt sich citegeist mit:

```
rm -rf /Applications/citegeist.app ~/Applications/citegeist.app
rm -f ~/.local/bin/cg
rm -rf ~/Library/Application\ Support/citegeist
```

Die dritte Zeile löscht Index und Python-Umgebung. Die Bibliothek mit deinen PDFs und Notizen bleibt unberührt.

Das Repository muss öffentlich sein (oder das Release muss in einem öffentlichen Repository liegen), damit `curl` ohne Token die API, das Skript und die Release-Dateien erreicht. Das Repository ist zurzeit privat, bis dahin liefert `install.sh` die Meldung, dass es kein lesbares Release gibt.

**Hinweis in der App.** Die App fragt höchstens einmal am Tag die Releases-API ab und vergleicht den Tag mit ihrer eigenen Version. Gibt es eine neuere Version, erscheint oben in der Leiste "Update verfügbar". Ein Klick öffnet das Terminal, das `install.sh` ausführt und citegeist ersetzt und neu startet. Squirrel.Mac (electron-updater) kommt nicht infrage, weil es eine signierte App voraussetzt.

**Release bauen.** Releases entstehen lokal, die CI-Minuten bleiben unberührt. Die Version steht in `apps/desktop/package.json`.

```
pnpm release --dry-run   # prüft alles und zeigt die Schritte
pnpm release             # baut, packt, schreibt die Prüfsumme, legt das GitHub-Release an
```

`scripts/release.sh` verweigert die Arbeit bei einem unsauberen Arbeitsbaum, bei einem vorhandenen Tag und bei einem Commit, der nicht auf `origin` liegt.

## Suche messen

Ein Testsatz aus 43 Suchfragen über sechs CC-BY-Dokumente (`fixtures/retrieval/`) läuft in `pnpm verify` und schlägt fehl, wenn hit@5 oder MRR unter die Messlatte in `fixtures/retrieval/baseline.json` fallen. Liegt das Einbettungsmodell im lokalen Cache (`~/Library/Caches/citegeist-embed-eval` oder der Modellordner der App), prüft der Test die Hybridsuche, sonst nur die Volltextsuche. Mit `CITEGEIST_SKIP_MODELS=1` (so läuft CI) lädt und liest er nie ein Modell.

```
pnpm eval:retrieval --golden                  Testsatz des Repos, Volltext und Hybrid
pnpm eval:retrieval --golden --record         neue Zahlen als Messlatte speichern
pnpm eval:retrieval --golden --rerank bge-reranker-v2-m3
pnpm eval:retrieval --library ~/Bibliothek --queries ~/fragen.json
```

Die zweite Form misst eine echte Bibliothek. Die Fragen stehen in einer Datei außerhalb des Repos, echte Bibliotheksdaten kommen nie hinein. Das Skript liest die Bibliothek nur und arbeitet auf einer Kopie des Index aus dem App-Ordner, die schon berechneten Vektoren werden also wiederverwendet. Die Fragen-Datei ist ein JSON-Array oder `{ "queries": [...] }`:

```json
[
  {
    "id": "q1",
    "lang": "de",
    "kind": "conceptual",
    "q": "Wie verändert sich der Anteil rauchender Jugendlicher?",
    "expect": [
      { "item": "lampert2019gesundheitliche", "contains": "starker Rückgang" },
      { "item": "anderer-citekey" }
    ]
  }
]
```

`item` ist der Citekey, `contains` ein Textausschnitt des Abschnitts, der die Frage beantwortet. Ohne `contains` zählt jeder Treffer des Items. Die Frage gilt als beantwortet, wenn eine der Angaben unter den ersten k Treffern liegt. Ausgegeben werden hit@1, hit@3, hit@5, hit@10, MRR und die Dauer pro Suche, getrennt nach Sprache und Art der Frage.

| Option | Wirkung |
|---|---|
| `--mode fts\|hybrid\|both` | Welche Suche gemessen wird, Standard `both` |
| `--model <Schlüssel>` | Einbettungsmodell aus `MODELS`, Standard ist `DEFAULT_MODEL` |
| `--models-dir <Ordner>` | Modelle von dort lesen, fehlende dorthin laden |
| `--kinds block,item,card,note` | Welche Treffer zählen, Standard bei `--library` `item,card,block` |
| `--rerank <Schlüssel>` | Zusätzlich mit Reranker messen (`--rerank-top`, `--rerank-tokens` stellen ihn ein) |
| `--details` | Rang jeder einzelnen Frage |
| `--json` | Zahlen als JSON |

Ändert sich, wie Abschnitte eingebettet werden (Überschriftenpfad, Modell), bettet der nächste Abgleich nur die Chunks neu ein, deren Eingabe sich geändert hat. Beim Wechsel auf den Überschriftenpfad sind das alle Abschnitte konvertierter Dokumente. Das dauert auf einem M4 Pro etwa 24 Chunks pro Sekunde, rund 7 Minuten für 10 000 Abschnitte, und läuft im Hintergrund. Notizen, Karten und Items bleiben unberührt.

## Erster Start

1. **Bibliothek.** Beim ersten Start wählst du einen Ordner. Ist er noch keine Bibliothek, fragt die App und legt `citegeist.json` und die Unterordner an. Die App merkt sich den Ordner für den nächsten Start.
2. **Python-Umgebung.** Unter Einstellungen steht der Worker. Mit dem Einrichten legt `uv` die Umgebung unter `Application Support/citegeist` an, das dauert beim ersten Mal einige Minuten und braucht Netz. Ohne diese Umgebung lassen sich PDFs nicht konvertieren.
3. **AI-Zugang.** Die Einstellungen zeigen, welche CLIs gefunden wurden. Ist Claude Code oder Codex abgemeldet, melde dich im Terminal an. API-Schlüssel sind optional und landen im Schlüsselbund.
4. **Semantische Suche** ist ausgeschaltet. Mit dem Schalter lädt die App das Embedding-Modell einmal herunter (EmbeddingGemma 300M). Die Wahl des Modells steht in `settings.update` unter `semantic.model` (`embeddinggemma-300m` oder `qwen3-embedding-0.6b`, das Bedienelement in den Einstellungen folgt mit dem neuen UI). Nach einem Wechsel baut die App den Index neu auf.
5. **Chat.** Die Seitenleiste fragt Claude Code oder Codex im Auftrag der Bibliothek. Jede Sitzung bekommt vom Kern ein eigenes Zugriffstoken für den MCP-Server, das nur auf 127.0.0.1 gilt.
6. **Pandoc** braucht nur der Export von Texten (Tab „Texte“ eines Projekts). citegeist findet es im PATH oder in `/opt/homebrew/bin`. Fehlt es, zeigt der Tab „Pandoc laden“ (oder `cg pandoc setup`), und das festgelegte Release mit fester Prüfsumme landet unter `Application Support/citegeist/pandoc/<Version>`. Ein PDF braucht zusätzlich eine LaTeX-Engine (`brew install --cask basictex`) oder Typst (`brew install typst`). Word, LaTeX und Markdown kommen ohne beides aus.
7. **Zotero Connector** und **Schnelleinfügen** sind ausgeschaltet und lassen sich in den Einstellungen aktivieren. Das Schnelleinfügen braucht für das Einfügen in andere Apps die Bedienungshilfen-Berechtigung.
