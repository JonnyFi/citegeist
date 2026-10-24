# Agents mit citegeist verbinden

Dieses Dokument sagt, wie ein Agent an citegeist kommt. Es gibt drei Wege: Agents auf deinem Mac sprechen mit `cg mcp`, der Chat in der Seitenleiste braucht keine Einrichtung, und Agents in der Cloud erreichen citegeist über einen Tunnel und einen Connector. Die Hintergründe zu Connectors, Signatur und Tunnel stehen in [webhooks.md](webhooks.md).

Die Befehle und Dateiformate der Clients stammen aus deren Dokumentation (Stand Oktober 2026): [Claude Code](https://code.claude.com/docs/en/mcp), [Cursor](https://cursor.com/docs/context/mcp), [Codex](https://developers.openai.com/codex/mcp) und [Claude Desktop](https://modelcontextprotocol.io/quickstart/user). Der Start von `cg mcp` aus einem Checkout ist mit diesem Repo geprüft (die Antwort auf `initialize` kommt). Die Clients selbst wurden nicht durchgespielt. Prüfe die Befehle gegen deine installierte Version.

## Lokal

Ein Agent auf deinem Mac startet citegeist als stdio-Server. Der Server heißt `cg mcp`. Läuft die App, leitet er an sie weiter, sonst öffnet er die Bibliothek selbst. Welche Bibliothek er nimmt, bestimmt `--library <Ordner>` vor `mcp`, danach `CITEGEIST_LIBRARY`, danach `~/Citegeist`. Mit `--scope read` bekommt der Agent nur lesende Werkzeuge.

Die App liefert `cg` noch nicht mit. Aus einem Checkout startest du es so, mit dem absoluten Pfad des Checkouts (`<repo>` unten):

```
<repo>/apps/cli/node_modules/.bin/tsx <repo>/apps/cli/src/bin.ts mcp
```

Der Start braucht ein vorheriges `pnpm install` im Checkout. Hast du `cg` im PATH, steht in den Beispielen unten einfach `cg mcp` statt dieser zwei Pfade.

### Claude Code

```
claude mcp add --scope user citegeist -- <repo>/apps/cli/node_modules/.bin/tsx <repo>/apps/cli/src/bin.ts mcp
```

Das `--` trennt die Optionen von Claude Code vom Startbefehl des Servers. Mit `--scope user` gilt der Eintrag für alle Projekte. `claude mcp list` zeigt, ob der Server verbunden ist.

### Cursor

Trage den Server in `~/.cursor/mcp.json` ein (global) oder in `.cursor/mcp.json` im Projekt:

```json
{
  "mcpServers": {
    "citegeist": {
      "command": "<repo>/apps/cli/node_modules/.bin/tsx",
      "args": ["<repo>/apps/cli/src/bin.ts", "mcp"]
    }
  }
}
```

### Codex

Der Befehl legt den Eintrag in `~/.codex/config.toml` an:

```
codex mcp add citegeist -- <repo>/apps/cli/node_modules/.bin/tsx <repo>/apps/cli/src/bin.ts mcp
```

Oder du schreibst den Eintrag selbst in die Datei:

```toml
[mcp_servers.citegeist]
command = "<repo>/apps/cli/node_modules/.bin/tsx"
args = ["<repo>/apps/cli/src/bin.ts", "mcp"]
```

### Claude Desktop

Öffne Settings > Developer > Edit Config. Die Datei liegt unter `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "citegeist": {
      "command": "<repo>/apps/cli/node_modules/.bin/tsx",
      "args": ["<repo>/apps/cli/src/bin.ts", "mcp"]
    }
  }
}
```

Danach beendest du Claude Desktop ganz und startest es neu. Eine Alternative ist das `.mcpb`-Paket (`node skills/citegeist/mcpb/build.mjs`). Sein Starter sucht `cg` unter `/Applications/citegeist.app/Contents/Resources/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` und im PATH, oder unter dem Pfad aus `CITEGEIST_CG`.

## Der Chat in der Seitenleiste

Der Chat in citegeist startet Claude Code oder Codex selbst und gibt jeder Sitzung ein eigenes Zugriffstoken für den MCP-Server. Dafür ist nichts einzurichten. Du brauchst nur das angemeldete `claude` oder `codex` auf dem Mac (siehe [run.md](run.md)).

## Agents in der Cloud

Ein Agent im Internet erreicht deinen Mac nur durch einen Tunnel. Die Einrichtung hat fünf Schritte.

**1. Tunnel auf Port 443.** Cloud-Agents erreichen nur den Port 443 (HTTPS). Auf 8443 lief bei Grok Bot ein Timeout ab. Läuft auf `/` schon eine andere App, leitest du nur die Pfade `/hooks` und `/mcp` weiter:

```
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
tailscale funnel status
```

`47321` ist der Hooks-Port aus Einstellungen > Webhooks. Cloudflare Tunnel statt Tailscale beschreibt [webhooks.md](webhooks.md#cloudflare-tunnel).

**2. Öffentliche Adresse.** Trage in Einstellungen > Webhooks > Öffentliche Adresse `https://<gerät>.<tailnet>.ts.net` ein, ohne Port und ohne Pfad. Fehlt die Adresse, zeigt citegeist statt des Textes für den Agent eine Warnung.

**3. Connector.** Lege in Einstellungen > Webhooks einen Connector an. Ein Beispiel für Cursors Cloud-Agent:

| Feld | Wert |
|---|---|
| Name | `phd-bot` |
| Art | Beides |
| Adresse des Agents | `https://api2.cursor.sh/automations/webhook/<routine-id>` |
| Header-Name | `Authorization` |
| Wert | `Bearer crsr_...` (der Schlüssel der Routine, mit `Bearer ` davor) |
| Bearer-Token | an (für Rückrufe, beginnt mit `whtok_`) |
| MCP-Zugang | Lesen und schreiben (Token beginnt mit `whmcp_`) |

Der Auth-Header und die zwei Token sind drei verschiedene Dinge, und alle drei beginnen mit `Bearer`. Der Schlüssel `crsr_...` gehört Cursor und geht von citegeist an Cursor. Der Token `whtok_...` geht vom Agent an citegeist, wenn er ein Ergebnis zurückschickt. Der Token `whmcp_...` geht vom Agent an citegeist, wenn er die Werkzeuge der Bibliothek benutzt.

**4. Text für den Agent kopieren.** Direkt nach dem Anlegen zeigt citegeist unter dem Connector den Abschnitt „An deinen Agent schicken“ mit einem fertigen Text. Die Token stehen darin vollständig, auch der ganze Header-Wert samt `Bearer `. Kopiere den Text und füge ihn in den Chat des Agents ein. Auch beim Einschalten des MCP-Zugangs, beim Einschalten des Bearer-Tokens und beim Erneuern eines Tokens erscheint der Text so. citegeist zeigt die Token nur dieses eine Mal. Später steht am Connector derselbe Text mit Platzhaltern wie `<MCP-TOKEN: in citegeist neu erzeugen>`, und eine Schaltfläche erzeugt einen neuen Token und setzt ihn in den Text ein. Der bisherige Token gilt dann nicht mehr.

**5. Prüfen.** „Test senden“ am Connector löst den Trigger des Agents aus. Die `curl`-Befehle unter „Prüfen“ in [webhooks.md](webhooks.md#prüfen) zeigen, ob der Tunnel offen ist.

### Grok Bot (xAI und Cursor)

Grok Bot kann einen MCP-Server nicht aus einem Geheimnisfeld dauerhaft speichern. Sein Werkzeug zum Hinzufügen eines Servers braucht den Header-Wert als Klartext im Chat. Der kopierte Text aus Schritt 4 ist dafür geschrieben. So sieht der MCP-Teil aus:

```
Trag citegeist als custom MCP server ein und speichere ihn dauerhaft. Suche nicht in deinem Katalog danach.

Name: citegeist
URL: https://<gerät>.<tailnet>.ts.net/mcp
Header-Name: Authorization
Header-Wert: Bearer whmcp_...
```

Die Wörter „custom MCP server“ sind wichtig. Ohne sie sucht Grok Bot in seinem Katalog und findet citegeist nicht. Für Rückrufe nutzt der Agent immer die Adresse `callback.url` aus dem jeweiligen `task.request`, mit den Headern `Authorization: Bearer whtok_...` und `x-citegeist-id: <UUID>`. Der Rest des Textes beschreibt die Bodys von `task.result`, `papers.add` und `note.add`.

### Fehlersuche

| Beobachtung | Ursache und Lösung |
|---|---|
| Timeout | Der Agent erreicht den Port nicht. Der Tunnel muss auf Port 443 laufen, 8443 und 10000 erreichen Cloud-Agents nicht. `tailscale funnel status` zeigt den Port. |
| `401` | Der Token ist falsch oder alt. Erzeuge den Token im Abschnitt „An deinen Agent schicken“ neu und gib dem Agent den neuen Text. `/mcp` verlangt den MCP-Token `whmcp_...`, `/hooks/<name>` den Bearer-Token `whtok_...` oder die Signatur. |
| `404` auf `/mcp` | Kein Connector hat MCP-Zugang. Schalte ihn am Connector ein. |
| `502` | Der Tunnel erreicht citegeist nicht. citegeist läuft nicht, oder es existiert kein Connector, dann lauscht der Hooks-Port nicht. |
| `429` | Zu viele Fehlversuche von derselben Quelle. Warte eine Minute. |
| Der Agent fragt bei jedem Werkzeugaufruf nach Freigabe | Der Server ist nicht dauerhaft gespeichert. Gib dem Agent den MCP-Teil des Textes noch einmal mit dem Token im Chat und bitte ihn, den Server dauerhaft zu speichern. |
