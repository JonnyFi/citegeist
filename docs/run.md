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

## Installation ohne Developer ID

citegeist ist ad hoc signiert und nicht notarisiert. Eine Datei, die `curl` herunterlädt, bekommt kein `com.apple.quarantine`-Attribut, und Gatekeeper prüft sie deshalb nicht. Darauf beruht die Installation, die ohne Apple Developer ID auskommt:

```
curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh
```

Das Skript `install.sh` macht Folgendes:

1. Es prüft macOS auf Apple Silicon und liest über die GitHub-API (`/releases/latest`) das neueste Release.
2. Es lädt `citegeist-<Version>-arm64.zip` mit `curl` und vergleicht die Prüfsumme mit der Datei `.sha256` des Releases. Bei einer Abweichung bricht es ab, ohne etwas zu installieren.
3. Es beendet ein laufendes citegeist, ersetzt `/Applications/citegeist.app` (ohne Schreibrecht dort `~/Applications/citegeist.app`) und startet die App.
4. Es prüft `uv` und mindestens eine der CLIs `claude`, `codex` und `cursor-agent` und nennt für Fehlendes den Installationsbefehl. Es installiert davon nichts.

Bibliothek und Einstellungen liegen außerhalb der App und bleiben bei einem Update erhalten. Entfernen lässt sich citegeist mit:

```
rm -rf /Applications/citegeist.app ~/Applications/citegeist.app
rm -rf ~/Library/Application\ Support/citegeist
```

Die zweite Zeile löscht Index und Python-Umgebung. Die Bibliothek mit deinen PDFs und Notizen bleibt unberührt.

Das Repository muss öffentlich sein (oder das Release muss in einem öffentlichen Repository liegen), damit `curl` ohne Token die API, das Skript und die Release-Dateien erreicht. Das Repository ist zurzeit privat, bis dahin liefert `install.sh` die Meldung, dass es kein lesbares Release gibt.

**Hinweis in der App.** Die App fragt höchstens einmal am Tag die Releases-API ab und vergleicht den Tag mit ihrer eigenen Version. Gibt es eine neuere Version, erscheint oben in der Leiste "Update verfügbar". Ein Klick öffnet das Terminal, das `install.sh` ausführt und citegeist ersetzt und neu startet. Squirrel.Mac (electron-updater) kommt nicht infrage, weil es eine signierte App voraussetzt.

**Release bauen.** Releases entstehen lokal, die CI-Minuten bleiben unberührt. Die Version steht in `apps/desktop/package.json`.

```
pnpm release --dry-run   # prüft alles und zeigt die Schritte
pnpm release             # baut, packt, schreibt die Prüfsumme, legt das GitHub-Release an
```

`scripts/release.sh` verweigert die Arbeit bei einem unsauberen Arbeitsbaum, bei einem vorhandenen Tag und bei einem Commit, der nicht auf `origin` liegt.

## Erster Start

1. **Bibliothek.** Beim ersten Start wählst du einen Ordner. Ist er noch keine Bibliothek, fragt die App und legt `citegeist.json` und die Unterordner an. Die App merkt sich den Ordner für den nächsten Start.
2. **Python-Umgebung.** Unter Einstellungen steht der Worker. Mit dem Einrichten legt `uv` die Umgebung unter `Application Support/citegeist` an, das dauert beim ersten Mal einige Minuten und braucht Netz. Ohne diese Umgebung lassen sich PDFs nicht konvertieren.
3. **AI-Zugang.** Die Einstellungen zeigen, welche CLIs gefunden wurden. Ist Claude Code oder Codex abgemeldet, melde dich im Terminal an. API-Schlüssel sind optional und landen im Schlüsselbund.
4. **Semantische Suche** ist ausgeschaltet. Mit dem Schalter lädt die App das Embedding-Modell einmal herunter (EmbeddingGemma 300M). Die Wahl des Modells steht in `settings.update` unter `semantic.model` (`embeddinggemma-300m` oder `qwen3-embedding-0.6b`, das Bedienelement in den Einstellungen folgt mit dem neuen UI). Nach einem Wechsel baut die App den Index neu auf.
5. **Chat.** Die Seitenleiste fragt Claude Code oder Codex im Auftrag der Bibliothek. Jede Sitzung bekommt vom Kern ein eigenes Zugriffstoken für den MCP-Server, das nur auf 127.0.0.1 gilt.
6. **Pandoc** braucht nur der Export von Texten (Tab „Texte“ eines Projekts). citegeist findet es im PATH oder in `/opt/homebrew/bin`. Fehlt es, zeigt der Tab „Pandoc laden“ (oder `cg pandoc setup`), und das festgelegte Release mit fester Prüfsumme landet unter `Application Support/citegeist/pandoc/<Version>`. Ein PDF braucht zusätzlich eine LaTeX-Engine (`brew install --cask basictex`) oder Typst (`brew install typst`). Word, LaTeX und Markdown kommen ohne beides aus.
7. **Zotero Connector** und **Schnelleinfügen** sind ausgeschaltet und lassen sich in den Einstellungen aktivieren. Das Schnelleinfügen braucht für das Einfügen in andere Apps die Bedienungshilfen-Berechtigung.
