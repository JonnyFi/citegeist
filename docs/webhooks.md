# Webhooks für externe Agents

Mit Webhooks schickt ein externer Agent wie ein Grok-Bot Paper und Notizen an citegeist, und citegeist schickt dem Agent Rechercheaufträge. Das Paket heißt `@citegeist/webhooks`. Die Entscheidungen dahinter stehen in D7 (Inbox als Standard) und D8 (allgemeine Webhooks, nicht nur Grok). Wie du einen Agent Schritt für Schritt anbindest, steht in [agents.md](agents.md). Dort und in Einstellungen > Webhooks > „An deinen Agent schicken“ findest du den fertigen Text zum Einfügen.

## Aufbau

Jeder Agent ist ein **Connector** mit einem Namen, zum Beispiel `grok`. Der Connector hat

- eine Adresse auf deinem Mac: `<Basis-URL>/hooks/grok`,
- ein Secret im macOS-Schlüsselbund (Konto `webhook-grok`, Dienst `citegeist`),
- den Akteur `agent:grok`. Alles, was er schreibt, trägt diese Herkunftsmarke,
- auf Wunsch einen Auth-Header für ausgehende Aufträge, einen Bearer-Token für eingehende Anfragen und einen MCP-Zugang (alle drei weiter unten). Ihre Werte liegen ebenfalls im Schlüsselbund, nie in einer Einstellungsdatei, und `webhooks.list` gibt sie nie zurück.

Es gibt drei Arten: `inbound` (der Agent schickt an citegeist), `outbound` (citegeist schickt dem Agent Aufträge, der Agent antwortet per Rückruf) und `both`.

Die Operationen `webhooks.list`, `webhooks.create`, `webhooks.rotateSecret`, `webhooks.setAuth`, `webhooks.setInboundToken`, `webhooks.setMcpAccess`, `webhooks.delete`, `webhooks.test` und `webhooks.send` laufen über denselben Kern wie alles andere (RPC und `cg`). Anlegen, Rotieren, Löschen, Testen und alle Zugangsdaten sind `admin`-Operationen und damit für Agents gesperrt. Die Verwaltung der Webhooks ist über MCP nicht erreichbar. Der MCP-Zugang eines Connectors (siehe unten) gibt dem Agent nur die Werkzeuge der Bibliothek.

```
cg webhooks create grok --kind both --url https://grok-bot.example.com/citegeist
```

Die Antwort enthält das Secret genau einmal. Danach liest es nur noch der Kern aus dem Schlüsselbund.

## Signatur

Jede Anfrage in beide Richtungen trägt drei Header:

| Header | Inhalt |
|---|---|
| `x-citegeist-id` | eindeutige Id der Zustellung, etwa eine UUID |
| `x-citegeist-timestamp` | Unix-Zeit in Sekunden |
| `x-citegeist-signature` | `v1=` plus Hex von HMAC-SHA256 über `<id>.<timestamp>.<Body>` mit dem Secret als Schlüssel |

Der Body ist JSON und wird byte-genau so signiert, wie er gesendet wird. Der Empfänger

1. verwirft Zeitstempel, die mehr als fünf Minuten von seiner Uhr abweichen,
2. vergleicht die Signatur in konstanter Zeit,
3. merkt sich die Id und weist dieselbe Id ein zweites Mal mit `409` ab (Replay).

Eine Anfrage mit falscher Signatur, unbekanntem Connector oder abgelaufenem Zeitstempel bekommt `401`. Die Antwort verrät nicht, ob der Connector existiert. Bodys über 1 MiB beantwortet der Kern mit `413`.

Nach `webhooks.rotateSecret` gilt das alte Secret noch `graceMinutes` Minuten (Standard 60), damit der Agent umstellen kann. Mit `graceMinutes: 0` ist es sofort ungültig. Mehrere Signaturen in einem Header, durch Leerzeichen getrennt, sind erlaubt.

### Bearer-Token statt Signatur

Manche Agents können keine HMAC-Signatur berechnen. Für sie lässt sich pro Connector ein Bearer-Token einschalten (Einstellungen > Webhooks > Bearer-Token, oder `cg webhooks set-inbound-token grok --enabled`, oder `--inbound-token` beim Anlegen). citegeist zeigt den Token genau einmal. Der Agent schickt dann statt der Signatur

```
Authorization: Bearer whtok_...
x-citegeist-id: <eindeutige Id>
```

Statt des Headers `x-citegeist-id` darf der Body ein Feld `"id"` tragen. Eine Anfrage ohne Id beantwortet citegeist mit `400`, eine wiederverwendete Id mit `409`. Den Token vergleicht der Kern in konstanter Zeit. Ist für den Connector kein Token eingeschaltet, beantwortet er jede Anfrage mit Token wie eine falsche Signatur mit `401`. Trägt eine Anfrage einen Signatur-Header, gilt nur die Signatur.

Der Preis: Wer den Token kennt, kann Anfragen senden, und es gibt keinen Zeitstempel, der einen mitgeschnittenen Aufruf nach einigen Minuten entwertet. Die Id schützt nur vor doppelter Zustellung (der Kern merkt sich Ids etwa elf Minuten und bis zum nächsten Start). Das Secret mit HMAC bleibt deshalb die stärkere Wahl, und der Token ist für Plattformen gedacht, die nichts anderes können. Mit `cg webhooks set-inbound-token grok --no-enabled` ist er sofort ungültig, ein neuer Aufruf mit `--enabled` erzeugt einen neuen Token.

## Eingehend: Paper und Notizen

`POST <Basis-URL>/hooks/<name>` mit einem JSON-Body, der ein Feld `event` hat.

**Paper hinzufügen** (`papers.add`). Ohne `target` landen die Paper in der Inbox (D7), mit `"target": "library"` direkt in der Bibliothek.

```json
{
  "event": "papers.add",
  "papers": [
    "10.1007/978-3-322-97010-7",
    { "url": "https://arxiv.org/abs/2401.00001", "why": "Diskussion im X-Thread von heute" }
  ],
  "why": "Grok-Suche nach Autopoiesis",
  "target": "inbox",
  "projects": ["systemtheorie"],
  "tags": ["x-thread"]
}
```

Ein Paper ist eine Kennung (DOI, arXiv-Id, ISBN, PMID, URL) oder ein Objekt mit `identifier` oder `url` und eigenem `why`. Bis zu 50 pro Anfrage. Die Antwort listet pro Paper `citekey`, `job` und gegebenenfalls `duplicateOf` oder einen Fehler. Ein fehlgeschlagenes Paper hindert die anderen nicht. Lokale Dateipfade (`/Users/...`, `~/...`, `file://`, `*.pdf` ohne DOI-Präfix) und Adressen dieses Macs oder privater Netze (`localhost`, `127.0.0.1`, `192.168.x.x`, `169.254.x.x`, `*.local`) lehnt der Empfänger mit `WEBHOOK_INPUT_REFUSED` ab, denn der Absender sitzt im Internet.

**Notiz oder Einsicht hinzufügen** (`note.add`):

```json
{
  "event": "note.add",
  "title": "Luhmann zu Autopoiesis",
  "text": "Autopoiesis beschreibt bei Luhmann die Selbsterzeugung sozialer Systeme ...",
  "type": "claim",
  "sources": [
    { "citekey": "luhmann1984soziale" },
    "10.1007/978-3-322-97010-7",
    "https://x.com/jemand/status/1",
    { "url": "https://example.org/post", "title": "Ein Blogbeitrag" }
  ],
  "projects": ["systemtheorie"]
}
```

Die Notiz entsteht mit dem Akteur `agent:<name>`. Die Quellen stehen am Ende als Abschnitt `## Sources`: ein Citekey wird zum Wiki-Link, eine Kennung landet als Paper in der Inbox und wird verlinkt, eine URL wird ein Markdown-Link. `type` ist einer der Notiztypen (Standard `permanent`).

**Ping** (`ping`) antwortet `200` mit `{"ok":true,"pong":true}` und prüft nur die Signatur.

## Ausgehend: Rechercheauftrag

`webhooks.send` schickt einem `outbound`- oder `both`-Connector einen Auftrag an seine URL:

```json
{
  "event": "task.request",
  "task": "j_01JB8Z3QK7ABCDEFGH",
  "prompt": "Finde neue soziologische Arbeiten zu Autopoiesis",
  "project": { "slug": "systemtheorie", "title": "Systemtheorie", "briefExcerpt": "Der Anfang des Projekt-Briefs ..." },
  "callback": { "url": "https://mac.beispiel.ts.net/hooks/grok", "event": "task.result" }
}
```

Der Auftrag ist signiert wie oben, mit demselben Secret, und trägt zusätzlich den Auth-Header des Connectors, falls einer gesetzt ist. `task` ist zugleich die Id des Jobs in citegeist (`jobs.get`). `briefChars` begrenzt den Brief-Auszug (Standard 2000 Zeichen, 0 sendet keinen). Antwortet der Agent nicht mit 2xx, versucht citegeist es nach 1 und nach 5 Sekunden noch einmal (drei Versuche). Das gilt für Netzfehler, `5xx`, `429` und `400`, denn eine abgeschaltete Routine nimmt die Anfrage nicht in eine Warteschlange auf. Bei `401`, `403`, `404`, `405` und `410` hilft ein Wiederholen nicht, dort bricht der Versuch sofort ab. Danach schlägt der Job mit `WEBHOOK_DELIVERY_FAILED` fehl.

### Auth-Header für die Plattform des Agents

Viele Plattformen prüfen am Trigger ihren eigenen Schlüssel und können `x-citegeist-signature` nicht prüfen, zum Beispiel `Authorization: Bearer <Token>` oder `x-api-key: <Schlüssel>`. Pro Connector lässt sich ein solcher Header setzen. citegeist sendet ihn bei jedem ausgehenden Auftrag und bei jedem Test zusätzlich zu den drei Signatur-Headern.

```
printf '%s' 'Bearer crsr_...' | cg webhooks create grok --kind both \
  --url https://api2.cursor.sh/automations/webhook/<routine-id> \
  --auth-header Authorization --auth-value-stdin
```

`--auth-value-stdin` liest den Wert von der Standardeingabe, damit er weder in der Prozessliste noch im Shell-Verlauf steht. Für einen bestehenden Connector gibt es `cg webhooks set-auth grok --auth-header x-api-key --auth-value-stdin`, und `cg webhooks set-auth grok` ohne Header entfernt ihn. In den Einstellungen sitzt der Wert in einem maskierten Feld. Der Name des Headers steht in `webhooks.json`, der Wert im Schlüsselbund (Konto `webhook-grok-auth`). Die Header `content-type`, `content-length`, `host`, `connection`, `transfer-encoding`, `user-agent` und alle mit `x-citegeist-` setzt citegeist selbst, sie sind als Name gesperrt.

Der Agent meldet das Ergebnis mit einem Rückruf an dieselbe Adresse, die auch für eingehende Anfragen gilt, und nennt die `task`-Id:

```json
{
  "event": "task.result",
  "task": "j_01JB8Z3QK7ABCDEFGH",
  "status": "succeeded",
  "summary": "Drei passende Arbeiten, eine davon ein Überblick.",
  "papers": ["10.1000/p1", "10.1000/p2"]
}
```

Die Paper landen in der Inbox des Projekts, die Zusammenfassung wird eine Notiz, und der Job wird mit dem Ergebnis abgeschlossen. `"status": "failed"` mit `error` lässt den Job fehlschlagen. Ein Connector kann nur Aufträge beantworten, die er selbst bekommen hat; ein zweiter Rückruf zur selben Id wird mit `409` abgewiesen. Ein Job wartet 24 Stunden auf den Rückruf.

## Erreichbarkeit aus dem Internet

### Der Hooks-Port

Der Kern lauscht auf einem zufälligen Port, der sich bei jedem Start ändert. Ein Tunnel kann darauf nicht zeigen. Deshalb öffnet citegeist einen zweiten Listener, solange mindestens ein Connector existiert:

- Er bindet nur `127.0.0.1` und lauscht auf einem festen Port, standardmäßig **47321**.
- Er beantwortet `/hooks/<name>` und, für Connectors mit MCP-Zugang, `/mcp`. Jeder andere Pfad (`/rpc`, `/health`, `/files`, `/events`) ergibt `404`, auch mit dem Token des Kerns.
- Der Port des Kerns bleibt privat. `/hooks/` antwortet dort aus Gründen der Abwärtskompatibilität noch, der Tunnel soll aber auf den Hooks-Port zeigen.

Den Port stellst du unter Einstellungen > Webhooks ein (oder `cg settings update --input '{"patch":{"webhooks":{"port":47400}}}'`). Eine Änderung gilt sofort, ohne Neustart. Ist der Port belegt, bleibt citegeist stabil, Einstellungen > Webhooks zeigt „Port 47321 ist schon belegt“ mit der Aufforderung, einen anderen zu wählen, und `webhooks.list` meldet `listener: { state: "error", code: "HOOKS_PORT_IN_USE" }`. Die Adressen der Connectors zeigen in dieser Zeit auf den Port des Kerns.

### Die öffentliche Adresse

Die Adresse deines Tunnels trägst du unter Einstellungen > Webhooks > Öffentliche Adresse ein (zum Beispiel `https://mac.tailnet-name.ts.net`). Sie liegt in den Einstellungen und überlebt damit den Start aus dem Dock oder dem Finder, der keine Umgebungsvariablen weitergibt. Die Umgebungsvariable `CITEGEIST_PUBLIC_URL` überschreibt die Einstellung, wenn sie gesetzt ist. Alles, was Adressen baut (`inboundUrl` in `webhooks.list`, die Rückruf-Adresse jedes Auftrags, die MCP-Adresse), nimmt den aufgelösten Wert. Gibt es einen ausgehenden Connector und keine öffentliche Adresse, zeigt die Oberfläche einen Hinweis, denn der Agent kann sein Ergebnis dann nicht zurückschicken.

Ein Tunnel funktioniert, solange der Mac wach ist und citegeist läuft. Scheitert eine Zustellung in der Zwischenzeit, sendet der Agent sie erneut. Die Replay-Sperre trifft nur Ids, die citegeist schon angenommen hat.

### Tailscale Funnel

Voraussetzung: Tailscale ist installiert und Funnel in deinem Tailnet freigeschaltet (Admin-Konsole, Access Controls, `funnel` für dein Gerät). Die Befehle folgen der Dokumentation von Tailscale (Stand Oktober 2026, <https://tailscale.com/kb/1311/tailscale-funnel>). Prüfe sie gegen die installierte Version.

```
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
tailscale funnel status
```

Der erste Befehl leitet `/hooks` weiter, der zweite `/mcp` (nur nötig, wenn ein Connector MCP-Zugang hat). Alles andere bleibt verborgen, und eine andere App kann auf `/` desselben Hosts weiterlaufen. Das Ziel enthält den Pfad, damit er beim Weiterleiten erhalten bleibt; prüfe das mit den Befehlen unter „Prüfen“. Funnel erlaubt nur die Ports 443, 8443 und 10000 nach außen. Nimm **443**: Agents in der Cloud erreichen nur diesen Port, auf 8443 lief bei Grok Bot ein Timeout ab. Der lokale Port ist frei. Die Adresse ist `https://<gerät>.<tailnet>.ts.net`. Mit `--bg` läuft Funnel weiter, bis du es abschaltest, auch nach einem Neustart des Macs. Beenden:

```
tailscale funnel --https=443 --set-path=/hooks off
tailscale funnel --https=443 --set-path=/mcp off
```

### Cloudflare Tunnel

Voraussetzung: ein Cloudflare-Konto mit einer Domain und `cloudflared` (`brew install cloudflared`).

```
cloudflared tunnel login
cloudflared tunnel create citegeist
cloudflared tunnel route dns citegeist hooks.beispiel.de
```

Die Konfiguration `~/.cloudflared/config.yml` lässt nur `/hooks` und `/mcp` durch:

```yaml
tunnel: citegeist
credentials-file: /Users/<du>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: hooks.beispiel.de
    path: ^/(hooks/|mcp$)
    service: http://127.0.0.1:47321
  - service: http_status:404
```

Dann `cloudflared tunnel run citegeist` und die Adresse `https://hooks.beispiel.de` als öffentliche Adresse eintragen. Für einen Test ohne Domain startet `cloudflared tunnel --url http://127.0.0.1:47321` einen Wegwerf-Tunnel mit zufälliger Adresse (nur zum Ausprobieren).

### Prüfen

```
cg webhooks test --name grok
curl -i https://hooks.beispiel.de/hooks/grok       # 405: der Weg ist offen, GET ist nicht erlaubt
curl -i https://hooks.beispiel.de/rpc/items/list   # 404: der Rest des Kerns ist nicht erreichbar
curl -i -X POST https://hooks.beispiel.de/mcp      # 401 mit MCP-Zugang, sonst 404
```

## Verbindung mit einem Agenten in der Cloud

Ein Agent im Internet erreicht deinen Mac nur durch einen Tunnel (Tailscale Funnel oder Cloudflare Tunnel), der auf den Hooks-Port zeigt. Das gilt für alles, was der Agent von sich aus an citegeist schickt: `papers.add`, `note.add`, das Ergebnis eines Auftrags (`task.result`) und den Zugriff über MCP.

Die Richtung vom Mac zum Agent braucht keinen Tunnel. Ein ausgehender `task.request` benötigt nur die öffentliche Trigger-Adresse des Agents und dessen Auth-Header. Damit der Agent aber antworten kann, muss die Rückruf-Adresse im Auftrag (`task.result`) erreichbar sein, und das ist sie nur durch den Tunnel und die eingetragene öffentliche Adresse.

| Was | Braucht einen Tunnel? |
|---|---|
| `task.request` an den Agent senden | nein, die Trigger-Adresse und der Auth-Header des Agents genügen |
| `task.result` des Agents zurück an citegeist | ja |
| `papers.add` und `note.add` vom Agent | ja |
| MCP-Zugriff des Agents auf die Bibliothek | ja |

Die Schritte:

1. Lege einen Connector an (Einstellungen > Webhooks oder `cg webhooks create`).
2. Richte den Tunnel auf `127.0.0.1:47321` ein (siehe oben) und trage seine Adresse als öffentliche Adresse ein.
3. Gib dem Agent, was er für seine Richtung braucht: das Secret oder den Bearer-Token für Anfragen an `/hooks/<name>`, den MCP-Token für `/mcp`.
4. Prüfe mit „Test senden“ und den `curl`-Befehlen oben.

Der Text für den Agent mit Adressen, Headern und Token entsteht in Einstellungen > Webhooks unter „An deinen Agent schicken“. [agents.md](agents.md) beschreibt den ganzen Ablauf mit Fehlersuche.

## MCP für Agents in der Cloud

Ein Agent in der Cloud erreicht keinen lokalen MCP-Server auf deinem Mac. Unterstützt er entfernte MCP-Server über HTTP, kann er dieselben Werkzeuge nutzen wie ein lokaler Agent: Der Hooks-Port bedient `/mcp` mit Streamable HTTP und dem Werkzeugsatz von `cg mcp`.

- **Opt-in pro Connector.** Einstellungen > Webhooks > MCP-Zugang (oder `cg webhooks set-mcp-access grok --enabled`, `--scope read` für nur lesende Werkzeuge, oder `--mcp write` beim Anlegen). citegeist erzeugt einen Token (`whmcp_...`), zeigt ihn einmal und legt ihn im Schlüsselbund ab (Konto `webhook-grok-mcp`).
- **Anmeldung.** `Authorization: Bearer <Token>`, verglichen in konstanter Zeit. Der Webhook-Secret und der eingehende Bearer-Token sind keine MCP-Tokens.
- **Akteur.** Alle Schreibzugriffe laufen als `agent:<connector>`, unabhängig davon, wie sich der Client nennt. Neue Paper landen in der Inbox (D7), genau wie bei einem lokalen MCP-Agent.
- **Rechte.** Wie bei lokalen MCP-Agents: Lesen und Schreiben, nie `admin`. Einstellungen, Webhooks und Löschungen jenseits von `trash_item` sind nicht erreichbar. Ein Agent im Internet darf außerdem keine Dateien dieses Macs lesen: `add_item` mit einem lokalen Pfad und `attach_file` lehnt der Kern ab.
- **Ohne Zugang kein Endpunkt.** Hat kein Connector MCP-Zugang, antwortet `/mcp` mit `404`. Mit Zugang folgt auf einen falschen Token `401`. Nach zehn Fehlversuchen innerhalb einer Minute von derselben Quelle (bei einem Tunnel die weitergereichte Adresse, `x-forwarded-for`) antwortet der Listener mit `429` und `retry-after`; insgesamt sind es 100 Fehlversuche pro Minute.
- **Entziehen.** `cg webhooks set-mcp-access grok --no-enabled` macht den Token sofort ungültig; das Löschen des Connectors tut dasselbe.

### Sitzungen und Neustarts

Clients der Version 2025 bekommen beim `initialize` eine Sitzung (`Mcp-Session-Id`). Der Kern hält sie nur im Speicher und verliert sie bei jedem Neustart, etwa nach einem Update der App. Die Werkzeuge hängen an keiner Sitzung, daher nimmt `/mcp` auch eine unbekannte Sitzungs-Id an: Der Kern legt eine neue Sitzung für denselben Connector an und nennt sie im Header `Mcp-Session-Id` der Antwort. Das Protokoll sieht hier eigentlich `404` vor, und manche Clients (Grok Bot) erholen sich davon nicht. Weitere Regeln:

- Eine Sitzung, die 24 Stunden niemand benutzt hat, schließt der Kern. Der nächste Aufruf mit ihrer Id öffnet eine neue.
- Auf offenen SSE-Strömen (`GET /mcp`) schickt der Kern alle 15 Sekunden einen Kommentar (`: keepalive`), damit Funnel oder Cloudflare einen stillen Strom nicht trennen.
- Ein Neustart des Kerns unterbricht laufende Aufrufe. Dazu zählen auch die Sekunden, in denen der Tunnel `502` liefert, weil der Hooks-Port noch nicht lauscht.

Für die Fehlersuche schreibt der Kern Zeilen mit dem Präfix `mcp:` in sein Log: `session ... opened`, `unknown session ... replaced by ...` (eine Sitzung aus der Zeit vor einem Neustart wurde ersetzt), `closed ... idle`, und bei `401` oder `429` die Quelle der Anfrage. Tokens und volle Sitzungs-Ids stehen nie darin. Der Kern läuft als Unterprozess der App und schreibt auf deren Standardfehlerausgabe, es gibt keine Logdatei. Wer die Zeilen sehen will, beendet citegeist und startet es im Terminal mit `/Applications/citegeist.app/Contents/MacOS/citegeist`. Ein Start aus dem Dock oder Finder verwirft die Ausgabe.

## Grok Bot (xAI und Cursor)

Grok Bot läuft in der Cloud mit eigenem Rechner (Browser, Dateisystem, Terminal). Er erreicht keine lokalen MCP-Server, unterstützt aber entfernte MCP-Server über HTTP. Routinen haben einen Webhook-Trigger: `POST https://api2.cursor.sh/automations/webhook/<routine-id>` mit `Authorization: Bearer crsr_...`. Der Body wird zur Eingabe des Laufs, der Aufruf antwortet sofort mit `200 {"success":true,"runUuid":"..."}`, mit `400` bei einer abgeschalteten Routine (die Anfrage wird dann nicht eingereiht) und mit `401` bei falschem Schlüssel.

**1. Tunnel.** Lege einen Connector an und richte Tailscale Funnel auf den Hooks-Port ein:

```
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
```

Trage `https://<gerät>.<tailnet>.ts.net` (ohne Port) unter Einstellungen > Webhooks > Öffentliche Adresse ein.

**2. MCP.** Schalte beim Connector den MCP-Zugang ein. citegeist zeigt danach unter „An deinen Agent schicken“ einen Text, den du in den Chat von Grok Bot einfügst. Grok Bot kann einen MCP-Server nicht aus einem Geheimnisfeld speichern, sein Werkzeug braucht den Header-Wert (`Bearer whmcp_...`) als Klartext im Chat, und die Wörter „custom MCP server“ im Text verhindern die Suche im Katalog. Danach nutzt Grok `search`, `add_item`, `create_card` und die übrigen Werkzeuge und schreibt als `agent:grok`. Die Einzelheiten stehen in [agents.md](agents.md#grok-bot-xai-und-cursor).

**3. Aufträge.** Lege in Grok Bot eine Routine mit Webhook-Trigger an. Trage ihre Adresse als Ziel des Connectors ein und `Authorization` mit `Bearer crsr_...` als Auth-Header (Art „Beides“). Mit `webhooks.send` oder dem Test in den Einstellungen löst citegeist die Routine aus. Das Ergebnis kommt auf einem der zwei Wege zurück: Die Routine ruft MCP-Werkzeuge auf, oder sie schickt `task.result` an die Rückruf-Adresse aus dem Auftrag, signiert mit dem Secret des Connectors (oder mit dem Bearer-Token, falls eingeschaltet).

Eine abgeschaltete Routine beantwortet den Aufruf mit `400`. citegeist versucht es dreimal, danach schlägt der Job mit `WEBHOOK_DELIVERY_FAILED` fehl und nennt den Status.

## Beispielclient für den Grok-Bot

Mit curl (OpenSSL und `uuidgen` sind auf dem Mac da). Der Body wird mit `--data-binary` gesendet, damit die Bytes genau die sind, die signiert wurden:

```bash
SECRET='whsec_...'                    # aus webhooks.create
URL='https://hooks.beispiel.de/hooks/grok'
BODY='{"event":"papers.add","papers":["10.1007/978-3-322-97010-7"],"why":"Grok-Fund aus dem X-Thread"}'

ID=$(uuidgen)
TS=$(date +%s)
SIG=$(printf '%s.%s.%s' "$ID" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -sS -X POST "$URL" \
  -H 'content-type: application/json' \
  -H "x-citegeist-id: $ID" \
  -H "x-citegeist-timestamp: $TS" \
  -H "x-citegeist-signature: v1=$SIG" \
  --data-binary "$BODY"
```

Mit Node (ab Version 18, ohne Pakete):

```js
import { createHmac, randomUUID } from "node:crypto";

const SECRET = process.env.CITEGEIST_WEBHOOK_SECRET;
const URL = process.env.CITEGEIST_WEBHOOK_URL; // https://hooks.beispiel.de/hooks/grok

export async function send(payload) {
  const body = JSON.stringify(payload);
  const id = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", SECRET).update(`${id}.${timestamp}.${body}`).digest("hex");
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-citegeist-id": id,
      "x-citegeist-timestamp": timestamp,
      "x-citegeist-signature": `v1=${signature}`,
    },
    body,
  });
  return { status: res.status, body: await res.json() };
}

console.log(await send({ event: "papers.add", papers: ["10.1007/978-3-322-97010-7"], why: "Grok-Fund" }));
```

Um einen Auftrag von citegeist zu prüfen, bildet der Bot dieselbe Signatur über `<x-citegeist-id>.<x-citegeist-timestamp>.<Rohbody>` und vergleicht sie mit dem Header, bevor er etwas ausführt. Den Rohbody liest er vor jedem JSON-Parsen.

## Einbau im Kern

`packages/webhooks` exportiert `attachWebhooks(host, options)`. `startCoreServer` in `packages/server` ruft es auf, bevor der RPC-Router gebaut wird, damit `webhooks.*` im Router steht:

1. `dir` ist der maschinenlokale Ordner der Bibliothek, `secrets` der Keychain (`MacKeychain`, auf anderen Systemen der Arbeitsspeicher), `port` liefert den gebundenen Port, `publicBaseUrl` stammt aus `CITEGEIST_PUBLIC_URL`, sonst aus der Einstellung `webhooks.publicUrl`.
2. Der Request-Listener fragt zuerst `hooks.handle(req, res)`. Pfade unter `/hooks/` beantwortet der Webhook-Dienst nach Signatur, alle anderen Pfade laufen weiter durch die Prüfungen von Host, Origin und Token.
3. Aufträge an externe Agenten sind Jobs der Art `research`. Dieselbe Art nutzen die Recherche-Jobs des Chats (`research.start`). Die Warteschlange hält pro Art einen Handler, deshalb teilen sich beide Nutzer die Art über `shareKind` aus `@citegeist/core`: Jeder bekommt einen eigenen Zugang (Port) mit eigenem Handler und eigener Parallelitätsgrenze. Jobs des Webhook-Dienstes tragen `webhook` im Input, alle anderen gehören dem Chat. Die Jobliste der App zeigt beide als Recherche.

4. Der Hooks-Port gehört `manageHooksListener` (`packages/server/src/core/hooks-listener.ts`). Er startet, verschiebt oder stoppt den Listener bei jeder Änderung der Einstellungen und bei jedem Anlegen oder Löschen eines Connectors. Der Listener reicht `/hooks/` an `attachWebhooks` weiter und `/mcp` an `createMcpRequestHandler` aus `@citegeist/mcp`, dieselbe Implementierung wie `cg mcp --http`, mit dem Akteur des Connectors und ohne Zugriff auf lokale Dateien.

Mit `startCoreServer({ webhooks: false })` entfallen Empfänger und Operationen, `webhooks: { secrets, publicBaseUrl, fetch, hooksPort, retryDelaysMs }` ersetzt Keychain, Adresse, HTTP-Client, Hooks-Port (0 wählt einen freien) und die Wartezeiten zwischen Zustellversuchen (Tests).
