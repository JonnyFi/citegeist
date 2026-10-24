# Webhooks für externe Agents

Mit Webhooks schickt ein externer Agent wie Jonnys Grok-Bot Paper und Notizen an citegeist, und citegeist schickt dem Agent Rechercheaufträge. Das Paket heißt `@citegeist/webhooks`. Die Entscheidungen dahinter stehen in D7 (Inbox als Standard) und D8 (allgemeine Webhooks, nicht nur Grok).

## Aufbau

Jeder Agent ist ein **Connector** mit einem Namen, zum Beispiel `grok`. Der Connector hat

- eine Adresse auf deinem Mac: `<Basis-URL>/hooks/grok`,
- ein Secret im macOS-Schlüsselbund (Konto `webhook-grok`, Dienst `citegeist`),
- den Akteur `agent:grok`. Alles, was er schreibt, trägt diese Herkunftsmarke.

Es gibt drei Arten: `inbound` (der Agent schickt an citegeist), `outbound` (citegeist schickt dem Agent Aufträge, der Agent antwortet per Rückruf) und `both`.

Die Operationen `webhooks.list`, `webhooks.create`, `webhooks.rotateSecret`, `webhooks.delete`, `webhooks.test` und `webhooks.send` laufen über denselben Kern wie alles andere (RPC und `cg`). Anlegen, Rotieren, Löschen und Testen sind `admin`-Operationen und damit für Agents gesperrt. Es gibt keinen MCP-Zugang zu Webhooks.

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

Ein Paper ist eine Kennung (DOI, arXiv-Id, ISBN, PMID, URL) oder ein Objekt mit `identifier` oder `url` und eigenem `why`. Bis zu 50 pro Anfrage. Die Antwort listet pro Paper `citekey`, `job` und gegebenenfalls `duplicateOf` oder einen Fehler. Ein fehlgeschlagenes Paper hindert die anderen nicht.

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

Der Auftrag ist signiert wie oben, mit demselben Secret. `task` ist zugleich die Id des Jobs in citegeist (`jobs.get`). `briefChars` begrenzt den Brief-Auszug (Standard 2000 Zeichen, 0 sendet keinen). Antwortet der Agent nicht mit 2xx, schlägt der Job mit `WEBHOOK_DELIVERY_FAILED` fehl.

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

citegeist lauscht nur auf `127.0.0.1`. Der Teil `/hooks/` ist der einzige, den der Kern ohne Zugriffstoken annimmt, weil dort die Signatur die Anmeldung ist. Damit ein Agent im Internet dich erreicht, brauchst du einen Tunnel. citegeist startet keinen von allein.

Die öffentliche Adresse trägst du ein, damit `webhooks.list` und die Rückruf-Adresse der Aufträge stimmen:

```
CITEGEIST_PUBLIC_URL=https://mac.beispiel.ts.net
```

Ohne Eintrag zeigen die Adressen auf `http://127.0.0.1:<Port>`, das nur Agents auf demselben Mac erreichen. Der Port steht in der Sperrdatei der Bibliothek (siehe `docs/run.md`).

Ein Tunnel funktioniert, solange der Mac wach ist und citegeist läuft. Scheitert eine Zustellung in der Zwischenzeit, sendet der Agent sie erneut. Die Replay-Sperre trifft nur Ids, die citegeist schon angenommen hat.

### Tailscale Funnel

Voraussetzung: Tailscale ist installiert und Funnel in deinem Tailnet freigeschaltet (Admin-Konsole, Access Controls, `funnel` für dein Gerät).

```
tailscale funnel --bg --set-path=/hooks http://127.0.0.1:<Port>/hooks
tailscale funnel status
```

`--set-path=/hooks` leitet nur diesen Pfad weiter, der übrige Kern bleibt verborgen. Die Befehle folgen der Dokumentation von Tailscale und Cloudflare; prüfe sie gegen die installierte Version. Die Adresse ist `https://<gerät>.<tailnet>.ts.net`; sie kommt als `CITEGEIST_PUBLIC_URL` in die Umgebung. Funnel erlaubt nur die Ports 443, 8443 und 10000 nach außen; der lokale Port ist frei. Beenden mit `tailscale funnel --https=443 off`.

Der Port des Kerns wechselt bei jedem Start, solange keiner festgelegt ist. Damit der Tunnel dauerhaft stimmt, startest du den Kern mit einem festen Port (Option `port` von `startCoreServer`).

### Cloudflare Tunnel

Voraussetzung: ein Cloudflare-Konto mit einer Domain und `cloudflared` (`brew install cloudflared`).

```
cloudflared tunnel login
cloudflared tunnel create citegeist
cloudflared tunnel route dns citegeist hooks.beispiel.de
```

Die Konfiguration `~/.cloudflared/config.yml` lässt nur `/hooks` durch:

```yaml
tunnel: citegeist
credentials-file: /Users/<du>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: hooks.beispiel.de
    path: ^/hooks/
    service: http://127.0.0.1:<Port>
  - service: http_status:404
```

Dann `cloudflared tunnel run citegeist` und `CITEGEIST_PUBLIC_URL=https://hooks.beispiel.de` setzen. Für einen Test ohne Domain startet `cloudflared tunnel --url http://127.0.0.1:<Port>` einen Wegwerf-Tunnel mit zufälliger Adresse (nur zum Ausprobieren).

### Prüfen

```
cg webhooks test --name grok
curl -i https://hooks.beispiel.de/hooks/grok       # 405: der Weg ist offen, GET ist nicht erlaubt
curl -i https://hooks.beispiel.de/rpc/items/list   # 404: der Rest des Kerns ist nicht erreichbar
```

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

1. `dir` ist der maschinenlokale Ordner der Bibliothek, `secrets` der Keychain (`MacKeychain`, auf anderen Systemen der Arbeitsspeicher), `port` liefert den gebundenen Port, `publicBaseUrl` stammt aus `CITEGEIST_PUBLIC_URL`.
2. Der Request-Listener fragt zuerst `hooks.handle(req, res)`. Pfade unter `/hooks/` beantwortet der Webhook-Dienst nach Signatur, alle anderen Pfade laufen weiter durch die Prüfungen von Host, Origin und Token.
3. Aufträge an externe Agenten sind Jobs der Art `research`. Dieselbe Art nutzen die Recherche-Jobs des Chats (`research.start`). Die Warteschlange hält pro Art einen Handler, deshalb teilen sich beide Nutzer die Art über `shareKind` aus `@citegeist/core`: Jeder bekommt einen eigenen Zugang (Port) mit eigenem Handler und eigener Parallelitätsgrenze. Jobs des Webhook-Dienstes tragen `webhook` im Input, alle anderen gehören dem Chat. Die Jobliste der App zeigt beide als Recherche.

Mit `startCoreServer({ webhooks: false })` entfallen Empfänger und Operationen, `webhooks: { secrets, publicBaseUrl, fetch }` ersetzt Keychain, Adresse und HTTP-Client (Tests).
