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

`pnpm package` baut die Oberfläche und die Electron-Bündel und schreibt danach `citegeist.app` für arm64. Die App ist nicht notarisiert und ad hoc signiert. Auf dem Rechner, auf dem sie gebaut wurde, startet sie ohne Rückfrage. Auf einem anderen Mac sperrt Gatekeeper sie, bis du sie über Rechtsklick und Öffnen freigibst.

Im Paket liegen die Quellen des Python-Workers (`Contents/Resources/workers/convert`), die CSL-Stile, die nativen Module und die beiden ACP-Adapter mit den Programmen von Claude Code und Codex.

Ob der Kern läuft, zeigt der Health-Aufruf. Port und Token stehen in der Sperrdatei der Bibliothek:

```
DIR=~/Library/Application\ Support/citegeist/<Bibliothek-Id>
curl -H "authorization: Bearer $(cat $DIR/core.token)" http://127.0.0.1:$(jq .port $DIR/core.lock)/health
```

## Erster Start

1. **Bibliothek.** Beim ersten Start wählst du einen Ordner. Ist er noch keine Bibliothek, fragt die App und legt `citegeist.json` und die Unterordner an. Die App merkt sich den Ordner für den nächsten Start.
2. **Python-Umgebung.** Unter Einstellungen steht der Worker. Mit dem Einrichten legt `uv` die Umgebung unter `Application Support/citegeist` an, das dauert beim ersten Mal einige Minuten und braucht Netz. Ohne diese Umgebung lassen sich PDFs nicht konvertieren.
3. **AI-Zugang.** Die Einstellungen zeigen, welche CLIs gefunden wurden. Ist Claude Code oder Codex abgemeldet, melde dich im Terminal an. API-Schlüssel sind optional und landen im Schlüsselbund.
4. **Semantische Suche** ist ausgeschaltet. Mit dem Schalter lädt die App das Embedding-Modell einmal herunter (EmbeddingGemma 300M). Die Wahl des Modells steht in `settings.update` unter `semantic.model` (`embeddinggemma-300m` oder `qwen3-embedding-0.6b`, das Bedienelement in den Einstellungen folgt mit dem neuen UI). Nach einem Wechsel baut die App den Index neu auf.
5. **Chat.** Die Seitenleiste fragt Claude Code oder Codex im Auftrag der Bibliothek. Jede Sitzung bekommt vom Kern ein eigenes Zugriffstoken für den MCP-Server, das nur auf 127.0.0.1 gilt.
6. **Zotero Connector** und **Schnelleinfügen** sind ausgeschaltet und lassen sich in den Einstellungen aktivieren. Das Schnelleinfügen braucht für das Einfügen in andere Apps die Bedienungshilfen-Berechtigung.
