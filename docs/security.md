# Sicherheitsprüfung

Stand: 2026-10-24, vor dem geplanten Open-Source-Release (D1). Geprüft wurde der Stand von `main` nach Pull Request 56. Die hohen Befunde sind im selben Branch behoben und mit Tests abgesichert. Von den mittleren Befunden sind M3 bis M7 und M9 behoben und mit Tests abgesichert, M8 ist zur Hälfte behoben. M1, M2 und der Rest von M8 bleiben offen, jeweils mit Begründung. Die niedrigen Befunde stehen unten mit einer Empfehlung.

## Vorgehen

Die Prüfung folgt dem Ablauf von gstack `/cso`: Angreifer, Grenze, Wirkung, dann der Versuch, den eigenen Befund zu widerlegen. Dazu gehören ein Anwendungs-Steckbrief, die Aufstellung der Angriffsflächen und die Suche nach Gegenbeweisen zu jeder Schutzmaßnahme. Diese Durchsicht wurde von Hand gemacht. Den statischen Lauf des Hilfsprogramms `gstack-cso` hat ein getrennter Agent als zweite, unabhängige Durchsicht ausgeführt, das Ergebnis steht im Abschnitt „Zweite Durchsicht“.

Geprüft wurden:

- die lokalen Server: Kern (`packages/server/src/core`), MCP-HTTP (`packages/mcp/src/transports.ts`), Webhooks (`packages/webhooks`), Zotero-Connector (`packages/server/src/connector`)
- die Dateiroute `/files/`
- die Keychain-Anbindung (`packages/core/src/settings/keychain.ts`)
- die Chat-Agents und ihre Berechtigungsregel (`packages/chat`, A11)
- die MCP-Werkzeuge und ihre Zugriffsklassen (`packages/ops`)
- Electron (`apps/desktop`) und die Darstellung von Webinhalten im Renderer (`packages/reader`)
- der Python-Worker (Downloads, Archive, Subprozesse)
- Abhängigkeiten: `pnpm audit` meldet für alle Pakete einschließlich Entwicklungswerkzeugen keine Schwachstelle. `pip-audit` auf dem Export von `workers/convert/uv.lock` (463 Zeilen) meldet ebenfalls keine.
- Geheimnisse im Repository: eine Suche im Arbeitsbaum und in der Historie nach Schlüsselmustern ergibt keinen Treffer.

## Was schon stimmt

| Bereich | Befund |
|---|---|
| Bindung | Kern, MCP-HTTP und Connector binden nur an `127.0.0.1`. MCP-HTTP verweigert jede andere Adresse beim Start |
| Host und Origin | Alle drei prüfen den Host-Header gegen DNS-Rebinding. Der Kern lässt nur die Origins des Renderers zu. Der Connector lässt nur Erweiterungs-Origins zu, und eine Preflight-Anfrage einer Webseite scheitert. Tests: `server.test.ts` („refuses foreign hosts and origins“), `mcp.test.ts`, `connector.test.ts` |
| Token | 32 Zufallsbytes, Vergleich mit `timingSafeEqual`, Datei `core.token` mit Rechten 0600, Entfernung beim Beenden |
| Dateiroute | Segmente ohne `.`, `..`, versteckte Namen und `\`. Danach `realpath` und Prüfung gegen `items/` samt Trennzeichen, damit Symlinks nach außen nicht tragen. Antworten tragen `content-security-policy: sandbox` und `nosniff`. Tests in `files.test.ts` |
| Webhook-Signatur | HMAC-SHA-256 über `id.zeitstempel.body`, Vergleich mit `timingSafeEqual`, Fenster von 300 Sekunden, Wiederholungsschutz pro Lieferungs-Id, Rotation mit Übergangszeit, 1 MiB Obergrenze, unbekannte Verbindungen antworten wie eine falsche Signatur. Secrets liegen in der Keychain |
| Keychain | Der Schlüssel geht hexkodiert über stdin an `security -i`, steht also in keiner Prozessliste. Fehlermeldungen entfernen den Schlüssel |
| MCP-Rechte | Operationen der Klasse `admin` sind über MCP nie sichtbar (`mcpContracts`, Test in `contracts.test.ts`). Lesende Token sehen nur lesende Werkzeuge. Jede Chat-Sitzung bekommt ein eigenes Schreib-Token |
| Electron | `contextIsolation`, `sandbox`, kein `nodeIntegration`. Berechtigungen außer dem Schreiben in die Zwischenablage sind verweigert. Navigation nach außen und neue Fenster öffnen nur `http(s)` im Browser. Deep Links laufen über eine feste Positivliste |
| Python-Worker | Downloads von GROBID und JRE mit fester SHA-256-Prüfsumme, `tarfile` mit `filter="data"`, Modelle mit festem Commit, kein `shell=True` |

## Behoben (hoch)

### H1: Der Filter für Webinhalte im Reader ließ Skripte durch

- Ort: `packages/reader/src/sanitize.ts`, Aufruf in `ReflowView.tsx` über `dangerouslySetInnerHTML`
- Angreifer: jede Webseite oder jedes Dokument, das der Nutzer (oder ein Agent in seinem Auftrag) importiert. Der Inhalt von `doc.html` ist fremdbestimmt.
- Grenze: Der Renderer hält über `window.citegeist.connection` Port und Token des Kerns. Ein Skript im Renderer steuert den Kern mit den Rechten des Menschen, einschließlich der `admin`-Operationen.
- Befund: Der alte Filter entfernte nur eine Liste von Elementen und `javascript:`-Adressen. `<svg><a href="#"><animate attributeName="href" values="javascript:..."/></a></svg>` blieb stehen, ebenso `set`, `use`, `foreignObject` und `annotation-xml`. Ein Klick auf den Link hätte das Skript im Renderer ausgeführt. Das Fehlschlagen des alten Codes ist im Test nachgewiesen.
- Behebung: SVG-Animationselemente und weitere Träger (`animate`, `set`, `use`, `foreignObject`, `noscript`, `template`, `annotation-xml`, Frames) werden anhand des kleingeschriebenen lokalen Namens entfernt, das Attribut `attributeName` fällt weg, und Adressen in `href`, `src`, `srcset`, `action` und verwandten Attributen müssen `http(s)`, `mailto`, `tel`, ein Rasterbild als `data:` oder schemenlos sein. Formeln in MathML und normale Links bleiben erhalten.
- Test: `packages/reader/src/reader.browser.test.tsx` („removes the bypasses of a plain deny list“, „keeps links, images and formulas of a converted paper“).

### H2: Ein Webhook-Absender konnte lokale Dateien einlesen und interne Adressen aufrufen lassen

- Ort: `packages/webhooks/src/service.ts`, `addPapers` ruft `items.add` mit einer vom Absender gelieferten Kennung auf
- Angreifer: ein Konto bei einem verbundenen Dienst, dessen Agent durch fremde Inhalte gesteuert wird (Prompt Injection), oder jeder, der ein Webhook-Secret besitzt. Der Endpunkt ist über einen Tunnel aus dem Internet erreichbar.
- Befund: `items.add` nimmt neben DOI und URL auch lokale Pfade (`/Users/...`, `~/...`, `file://`, relative Dateinamen) und beliebige `http(s)`-Adressen. Ein Absender konnte so jede PDF-, HTML- oder EPUB-Datei des Macs in die Bibliothek ziehen lassen und den Kern zu Aufrufen auf `127.0.0.1`, das lokale Netz oder `169.254.169.254` bringen.
- Behebung: Neu ist `packages/webhooks/src/remote-input.ts`. Vor dem Aufruf von `items.add` weist `assertRemoteSafe` lokale Dateipfade, Nicht-HTTP-Schemata und Adressen auf diesem Mac oder in privaten Netzen mit `WEBHOOK_INPUT_REFUSED` ab. Zu den Adressen zählen Loopback, die Bereiche 10/8, 172.16/12, 192.168/16, 169.254/16 und 100.64/10, IPv6-Loopback und -lokal, `*.local`, `*.localhost`, `*.internal` und Namen ohne Punkt. Dezimale und hexadezimale IP-Schreibweisen normalisiert der URL-Parser vorher. Das gilt auch für die Quellen einer `note.add`-Anfrage.
- Grenze der Behebung: Ein öffentlicher Name, der auf eine private Adresse zeigt, und Weiterleitungen deckt diese Prüfung nicht ab. Das übernimmt seit M5 der Kern für jeden Akteur außer dem Menschen.
- Test: `packages/webhooks/src/webhooks.test.ts` (drei neue Fälle: Ablehnung von 14 Eingaben ohne Aufruf von `items.add`, Zulassung von DOI, arXiv-Id, öffentlicher URL und BibTeX, Quellen einer Notiz). Die Doku steht in `docs/webhooks.md`.

### H3: Der isolierte Agent und Recherche-Aufträge lasen die ganze Platte und hatten einen offenen Ausgang

- Ort: `packages/chat/src/policy.ts`
- Angreifer: Text auf einer Webseite, die ein Recherche-Auftrag oder ein isolierter Chat abruft (Prompt Injection). Recherche-Aufträge laufen ohne Aufsicht.
- Befund: Die Regel erlaubte `read` und `search` für jeden Pfad und `fetch` für jede Adresse. Dazu kam, dass `add_item` und `attach_file` lokale Dateien in die Bibliothek ziehen, die der Agent danach mit `read_document` lesen kann. Daraus ergibt sich eine Kette: fremder Text, dann `~/.ssh/id_ed25519`, `core.token` oder eine Datei aus Dokumente lesen, dann ein Abruf mit den Daten in der Adresse. Der Zweck der Isolierung (A11: „keine Nutzereinstellungen, nur die citegeist-Werkzeuge“) wurde dadurch nicht erreicht.
- Behebung: Im isolierten Chat und in jedem Recherche-Auftrag sind `read` und `search` auf den Bibliotheksordner und den Arbeitsordner der Sitzung beschränkt (Pfadargumente und der feste Teil von `pattern` und `glob`). `add_item` mit lokalem Pfad und `attach_file` sind in Recherche-Aufträgen gesperrt und im isolierten Chat auf Dateien innerhalb von Bibliothek und Arbeitsordner beschränkt. Im nicht isolierten Chat (A11, Standard) bleibt alles wie bisher.
- Rest: `fetch` bleibt offen, denn Recherche braucht das Netz. Ein Agent kann Daten, die er legitim lesen darf (die Bibliothek), in Adressen kodieren. Das ist ein Restrisiko des Auftrags und steht als L9 unten.
- Grenze der Behebung: Die Regel greift dort, wo der Adapter eine Berechtigungsanfrage stellt. Der Rückfall `claude -p` gibt `mcp__citegeist` pauschal frei. Dass ein Recherche-Auftrag dort keine lokalen Dateien einlesen lässt, setzt seit M4 der Kern durch.
- Test: `packages/chat/src/policy.test.ts` (Blöcke „reading outside the library“ und „local files in citegeist tool calls“).

## Behoben (mittel)

### M3: Eine Content-Security-Policy schützt den Renderer

- Ort: `apps/ui/index.html`, neu `apps/ui/csp.ts` (Vite-Plugin), eingebunden in `apps/ui/vite.config.ts`
- Befund: Der Renderer setzte keine Policy. Ein Fehler im Filter für Webinhalte (H1) hätte zur Ausführung von Skripten im Renderer geführt, der Port und Token des Kerns hält.
- Behebung: Der Produktions-Build trägt ein `<meta http-equiv="Content-Security-Policy">` als erstes Element im Kopf (der Renderer lädt aus `file://`, dort gibt es keinen Antwort-Header). `script-src 'self' 'wasm-unsafe-eval'` samt Hash des einen Inline-Skripts zur Themenwahl, ohne `unsafe-inline` und ohne `unsafe-eval`. `default-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*`, `img-src 'self' data: blob: http://127.0.0.1:*`. Der Dev-Server bekommt keine Policy, weil Vite für das Neuladen Inline-Skripte einfügt.
- Folge: Bilder von fremden Servern lädt der Reader nicht mehr nach. Konvertierte Dokumente verweisen auf ihre lokalen Dateien über die Dateiroute des Kerns, die weiter erlaubt ist.
- Test: `apps/ui/csp.test.ts` (Hash passt zum Inline-Skript, keine unsichere Quelle, `connect-src` nur auf den Kern) und der Playwright-Test „the Content-Security-Policy blocks inline scripts and foreign connections“ in `apps/desktop/e2e/app.e2e.ts`, der in der gebauten App einen Inline-Skript-Versuch und einen Abruf von `example.org` auslöst. Die Lese-Ansicht mit pdf.js läuft unter der Policy im Test „adds a PDF, reads it“ in `v01.e2e.ts`.

### M4: Der Kern erzwingt, dass Recherche-Sitzungen keine lokalen Dateien einlesen

- Ort: `packages/ops/src/registry.ts` (`OpContext.localFiles`), `packages/mcp/src/transports.ts`, `packages/core/src/ingest/index.ts`, `packages/server/src/core/chat.ts`
- Befund: Die MCP-Token kannten nur `read` und `write`. `items.add` mit Pfad und `items.attach` lasen lokale Pfade für jeden schreibenden Akteur, und die Regel aus H3 greift im Rückfall `claude -p` nicht.
- Behebung: Ein Token trägt die Fähigkeit `localFiles` (Standard: erlaubt). Der MCP-Server reicht sie als `localFiles: false` im Kontext jeder Operation weiter, für Sitzungen nach dem Protokoll von 2025 ebenso wie für die einzelnen Anfragen nach dem von 2026-07-28. Fehlt die Authentifizierungsangabe, gilt die Fähigkeit als entzogen. `items.add` lehnt Pfade, `file://`-Adressen und lose Dateinamen ab, `items.attach` lehnt jeden Aufruf ab, jeweils mit `LOCAL_FILES_FORBIDDEN`. DOI, arXiv-Id, URL und BibTeX bleiben möglich. Das Token jeder Recherche-Sitzung trägt `localFiles: false`, das Token einer Chat-Sitzung erlaubt sie (im isolierten Chat beschränkt die Regel aus H3 sie auf Bibliothek und Arbeitsordner).
- Test: `packages/core/src/ingest/local-files.test.ts`, `packages/mcp/src/local-files.test.ts` (beide Protokollvarianten) und „revokes the token when a research session ends and refuses local files to it“ in `packages/server/src/core/chat.test.ts` (Recherche-Sitzung scheitert an der Datei, eine Chat-Sitzung legt sie an).

### M5: Der Abruf von URLs prüft Adressen, Weiterleitungen und Größe

- Ort: `packages/core/src/ingest/service.ts` (`get`), neu `packages/core/src/ingest/net-guard.ts`
- Befund: Der Abruf folgte Weiterleitungen und prüfte weder Loopback noch private Bereiche. Ohne `Content-Length` las er unbegrenzt in den Speicher.
- Behebung: Für jeden Akteur außer `human` (Agents, der Zotero-Connector, Aufträge des Systems, Webhook-Absender) wird jede Station des Abrufs geprüft. Weiterleitungen folgt der Kern selbst, höchstens fünf, und prüft jede Zieladresse neu. Ein Name wird aufgelöst, und jede Adresse muss öffentlich sein. Abgelehnt werden Loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, Multicast und reservierte Bereiche, bei IPv6 `::1`, `::`, fc00::/7, fe80::/10, fec0::/10, ff00::/8 sowie eingebettete IPv4-Adressen (`::ffff:`, `64:ff9b::`, `2002::`), dazu `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.lan` und Namen ohne Punkt, mit `URL_NOT_PUBLIC`. Der Mensch darf weiter jede Adresse abrufen, etwa eine PDF im Firmennetz. Den Körper liest der Kern als Datenstrom und bricht bei der Obergrenze (300 MiB) ab, auch ohne `Content-Length`.
- Grenze der Behebung: Zwischen der Auflösung und dem Abruf löst `fetch` den Namen ein zweites Mal auf. Ein Server, der dabei die Adresse wechselt (DNS-Rebinding), kommt durch. Das schließt nur ein Abruf, der sich an die geprüfte Adresse bindet. Der Zotero-Connector wird als Akteur `agent:zotero-connector` ebenfalls geprüft, eine Adresse im Firmennetz speichert er also nicht mehr.
- Test: `packages/core/src/ingest/net-guard.test.ts` (Adressbereiche, Schreibweisen, Auflösung) und `packages/core/src/ingest/ssrf.test.ts` (Abruf von 127.0.0.1 und 169.254.169.254 ohne Anfrage, Weiterleitung auf eine private Adresse, Name mit privater Auflösung, Abbruch bei Überschreitung der Größe ohne `Content-Length`, freier Zugriff für den Menschen).

### M6: Das Token einer MCP-Sitzung steht nicht mehr auf der Kommandozeile

- Ort: `packages/chat/src/print-driver.ts`
- Befund: Der Rückfall `claude -p` übergab `--mcp-config` mit dem Bearer-Token als Argument, das jeder Prozess mit `ps` las.
- Behebung: Die Konfiguration steht in `mcp.json` mit Rechten 0600 in einem privaten Ordner (0700, `mkdtemp` unter dem temporären Verzeichnis), der Pfad geht an `--mcp-config`. `close()` entfernt den Ordner.
- Test: `packages/chat/src/fallback.test.ts` („keeps the session token off the command line and in a private file“, dazu die Prüfung der Argumente im Ablauf mit dem Ersatz für `claude`).

### M7: Sitzungs-Token werden entzogen

- Ort: `packages/chat/src/service.ts` (`ChatHost.release`, `ChatService.end`), `packages/chat/src/research.ts`, `packages/server/src/core/chat.ts`
- Befund: Das Schreib-Token einer Sitzung blieb bis zum Ende des Kerns gültig, das Feld `tokens` wuchs.
- Behebung: Sobald der Agent einer Sitzung verschwindet (Schließen, Wechsel der Umgebung wegen A11, Absturz, Ende des Kerns), ruft der Dienst `release` auf, und der Kern entfernt das Token aus der Liste. Der MCP-Server liest die Liste bei jeder Anfrage, der Entzug wirkt also sofort. Ein Recherche-Auftrag beendet seine Sitzung am Ende (`end`). Ein neuer Agent derselben Sitzung bekommt ein neues Token.
- Test: `packages/chat/src/chat.test.ts` („tells the host when the agent of a session is gone“) und in `packages/server/src/core/chat.test.ts` „revokes the token of a session when its agent ends“ (401 nach dem Entzug, andere Sitzungen unberührt).

### M8 (Teil): Fuses und Prüfung des IPC-Absenders

- Ort: `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/quick-insert/electron.ts`, `apps/desktop/src/shared/trusted-sender.ts`
- Behoben: Die Fuses `enableNodeOptionsEnvironmentVariable` und `enableNodeCliInspectArguments` sind abgeschaltet, `onlyLoadAppFromAsar` ist an. `RunAsNode` bleibt an, denn die Chat-Adapter laufen als Programm der App mit `ELECTRON_RUN_AS_NODE` (`packages/chat/src/backends.ts`). Jeder IPC-Handler (`citegeist:connection`, `open-library`, `create-library`, `pick-paths`, `navigate-ready` und die Handler des Schnellzugriffs) prüft `event.senderFrame`: Es muss der oberste Frame der eigenen Oberfläche sein, also die gebaute `index.html` (mit beliebigem Hash) oder der Ursprung des Dev-Servers. Jede andere Seite bekommt `null` statt der Verbindung. Der Test auf Navigation in `will-navigate` und die Prüfung des Schnellzugriffs benutzen dieselbe Funktion statt `startsWith("file://")`.
- Test: `apps/desktop/src/shared/trusted-sender.test.ts`, `apps/desktop/src/packaging.test.ts` (Fuses und die Kopplung an `ELECTRON_RUN_AS_NODE`) und der Playwright-Test „a page that is not the renderer gets no core connection from the preload bridge“, der ein Fenster mit demselben Preload auf eine `data:`-Seite lädt.

### M9: Das Token im Query-Parameter gilt nur für zwei Pfade

- Ort: `packages/server/src/core/server.ts` (`queryTokenPath`)
- Behebung: `?token=` nehmen nur `/events` (WebSocket) und `/files/` (Bild, Frame) an. Auf allen anderen Pfaden zählt allein der Header `Authorization`.
- Test: „takes the token as a query parameter on the event and file routes only“ in `packages/server/src/core/server.test.ts`.

## Mittel, offen

| Nr. | Befund | Begründung |
|---|---|---|
| M1 | **Agents mit Shell lesen das Token des Kerns.** Im nicht isolierten Chat (A11) kann der Agent `core.token` und `core.lock` lesen und den Kern ohne `x-citegeist-actor` als `human` ansprechen, also auch `settings.update`, `ai.testBackend` und `worker.setup`. `by:` zeigt dann `human` | Die Entscheidung A11 gibt dem Agent die Umgebung des Nutzers, dazu gehört die Shell. Eine Trennung in ein Renderer-Token und ein Datei-Token mit festem Akteur `agent:cg` würde den Befehl `cg` für den Nutzer selbst einschränken, denn ein Mensch im Terminal und ein Agent mit Shell benutzen dieselbe Datei und sind nicht zu unterscheiden. Dann liefen `cg settings` und die anderen `admin`-Operationen nicht mehr aus dem Terminal. Eine Rückfrage im Hauptprozess vor `admin`-Operationen ändert den Ablauf für den Nutzer ebenso. Wer das nicht in Kauf nimmt, schaltet in den Einstellungen „Isolierter Agent“ ein: Dort gibt es keine Shell, und Recherche-Aufträge laufen immer so. Die Frage bleibt bei Jonny, falls A11 neu bewertet wird |
| M2 | **Keychain-Einträge sind für jeden Prozess des Benutzers lesbar.** Ein Agent mit Shell liest `security find-generic-password -s citegeist -a openai -w` ohne Rückfrage (auf einem Mac nachzuprüfen) | Der Kern liest und schreibt die Einträge selbst mit dem Werkzeug `security`. Eine Zugriffsliste nur für die App (`-T`) würde auch den Kern aussperren, solange er `security` aufruft. Die Lösung ist ein Zugriff aus der signierten App (`safeStorage` im Hauptprozess, Weitergabe über IPC an den Kern), und sie setzt eine feste Code-Signatur voraus (Rest von M8), weil die Zugriffsliste an der Signatur hängt. Mit der Ad-hoc-Signatur änderte sie sich bei jedem Build, und macOS fragte nach jedem Update neu. Zudem liest ein Agent mit der Shell des Nutzers unter A11 ohnehin Dateien wie `~/.ssh` und die Konfiguration anderer Werkzeuge. Im isolierten Chat und in Recherche-Aufträgen gibt es keine Shell, dort ist der Eintrag nicht erreichbar |
| M8 (Rest) | **Signatur und Notarisierung fehlen.** `hardenedRuntime: false`, ad-hoc-Signatur, keine Notarisierung | Dafür braucht es ein Developer-ID-Zertifikat und ein Apple-Konto, das es nicht gibt. Die gehärtete Laufzeit lässt sich mit der Ad-hoc-Signatur nicht sinnvoll einschalten, denn sie verlangt Rechte für die nativen Module und lässt sich erst mit einer echten Signatur prüfen. Vor dem Release setzt der Lead `hardenedRuntime: true`, die Entitlements und `notarize: true`, `RunAsNode` bleibt wegen der Chat-Adapter an |

## Niedrig

| Nr. | Befund | Empfehlung |
|---|---|---|
| L1 | Der Kern lässt `Origin: null` zu, weil `file://` so auftritt. Auch jede Seite in einem Sandbox-Frame sendet sie. Das Token bleibt die eigentliche Sperre | Den Renderer über ein eigenes Schema (`app://`) laden und `null` streichen |
| L2 | Der Wiederholungsschutz der Webhooks liegt im Speicher. Nach einem Neustart ist eine mitgeschnittene Lieferung innerhalb von 5 Minuten noch einmal gültig | Zuletzt gesehene Ids in einer kleinen Datei halten oder das Zeitfenster nach dem Start abwarten |
| L3 | Kein Ratenlimit auf `/hooks/<name>`. Der Körper wird bis 1 MiB vor der Prüfung gelesen | Anfragen je Quelladresse und Minute zählen, `requestTimeout` des Servers kürzen |
| L4 | Der Tunnel reicht nach `docs/webhooks.md` den ganzen Port nach außen. Nur `/hooks/` ist ohne Token erreichbar, der Host-Check schützt den Rest | Tunnel auf den Pfad `/hooks/*` beschränken (Funnel-Pfad oder Cloudflare-Regel) |
| L5 | Der Connector (Standard aus) akzeptiert die Origin jeder Browser-Erweiterung, nicht nur der von Zotero | Erweiterungs-Ids des Zotero Connector fest eintragen |
| L6 | `fm.URL` landet als `href` in der Oberfläche. React 19 sperrt `javascript:`, und der Hauptprozess öffnet nur `http(s)`. Das Schema prüft die Adresse nicht | `URL` im Frontmatter-Schema auf `http(s)` beschränken |
| L7 | GitHub Actions sind per Tag statt per Commit-Hash gepinnt, es gibt keinen Dependabot | Hashes pinnen, Dependabot für npm, uv und Actions einschalten |
| L8 | Die Verzeichnisse unter `~/Library/Application Support/citegeist` entstehen mit der Standardmaske. Die Dateien mit Geheimnissen haben 0600 | Verzeichnisse mit 0700 anlegen |
| L9 | Der offene Abruf (`fetch`) bleibt für isolierte Agents. Lesbare Daten (die Bibliothek) lassen sich in Adressen kodieren | In Recherche-Aufträgen nur `WebSearch` und `WebFetch` zulassen und die Antwortgröße begrenzen. Wer sensible Bibliotheken führt, schaltet Recherche-Aufträge ab |
| L10 | `spikes/*/out` enthält extrahierten Volltext fremder Dokumente (Lizenz, siehe `docs/licenses.md`) | Vor dem Release aus dem Repository nehmen |

## Zweite Durchsicht (gstack-cso)

Der statische Lauf (`--code --offline`, 600 Sekunden) endete mit dem Status **partial**. Er meldet für den geprüften Umfang keinen belegten Befund. Gelesen hat er Kernserver, Dateiroute, Webhooks, MCP-HTTP, Connector und Electron-Hauptprozess. Nicht gelesen hat er den Abruf in `ingest/service.ts`, die Operationsverträge, den Chat-Dienst, den Reader und die Oberfläche. Scanner liefen nicht, eine unabhängige Gegenprüfung fand nicht statt. Die vier Hypothesen des Laufs:

| Hypothese | Stand |
|---|---|
| Webhook-SSRF über Namen, die auf private Adressen zeigen, und über Weiterleitungen | bestätigt als Grenze von H2, behoben unter M5 |
| `read` und `search` mit einem absoluten Pfad nur in `pattern` oder `glob` umgehen die Lesebeschränkung | bestätigt und behoben: `policy.ts` prüft nun den festen Teil von `pattern` und `glob` und löst relative Pfade gegen den Arbeitsordner auf. Test in `policy.test.ts` |
| Token im Query-Parameter | behoben unter M9 |
| Connector ohne Token für lokale Prozesse ohne Origin | gewollt, weil das Protokoll des Zotero Connector kein Token kennt. Ein lokaler Prozess mit Zugriff auf `core.token` hätte ohnehin vollen Zugriff (M1). Der Connector ist standardmäßig aus |

Die Abdeckung des Laufs ist begrenzt. Die Befunde H1 bis H3 stammen aus der manuellen Durchsicht.
