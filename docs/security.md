# Sicherheitsprüfung

Stand: 2026-10-24, vor dem geplanten Open-Source-Release (D1). Geprüft wurde der Stand von `main` nach Pull Request 56. Die hohen Befunde sind im selben Branch behoben und mit Tests abgesichert. Die mittleren und niedrigen Befunde stehen unten mit einer Empfehlung.

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
- Grenze der Behebung: Ein öffentlicher Name, der auf eine private Adresse zeigt, und Weiterleitungen sind nicht abgedeckt, siehe M5.
- Test: `packages/webhooks/src/webhooks.test.ts` (drei neue Fälle: Ablehnung von 14 Eingaben ohne Aufruf von `items.add`, Zulassung von DOI, arXiv-Id, öffentlicher URL und BibTeX, Quellen einer Notiz). Die Doku steht in `docs/webhooks.md`.

### H3: Der isolierte Agent und Recherche-Aufträge lasen die ganze Platte und hatten einen offenen Ausgang

- Ort: `packages/chat/src/policy.ts`
- Angreifer: Text auf einer Webseite, die ein Recherche-Auftrag oder ein isolierter Chat abruft (Prompt Injection). Recherche-Aufträge laufen ohne Aufsicht.
- Befund: Die Regel erlaubte `read` und `search` für jeden Pfad und `fetch` für jede Adresse. Dazu kam, dass `add_item` und `attach_file` lokale Dateien in die Bibliothek ziehen, die der Agent danach mit `read_document` lesen kann. Daraus ergibt sich eine Kette: fremder Text, dann `~/.ssh/id_ed25519`, `core.token` oder eine Datei aus Dokumente lesen, dann ein Abruf mit den Daten in der Adresse. Der Zweck der Isolierung (A11: „keine Nutzereinstellungen, nur die citegeist-Werkzeuge“) wurde dadurch nicht erreicht.
- Behebung: Im isolierten Chat und in jedem Recherche-Auftrag sind `read` und `search` auf den Bibliotheksordner und den Arbeitsordner der Sitzung beschränkt (Pfadargumente und der feste Teil von `pattern` und `glob`). `add_item` mit lokalem Pfad und `attach_file` sind in Recherche-Aufträgen gesperrt und im isolierten Chat auf Dateien innerhalb von Bibliothek und Arbeitsordner beschränkt. Im nicht isolierten Chat (A11, Standard) bleibt alles wie bisher.
- Rest: `fetch` bleibt offen, denn Recherche braucht das Netz. Ein Agent kann Daten, die er legitim lesen darf (die Bibliothek), in Adressen kodieren. Das ist ein Restrisiko des Auftrags und steht als L9 unten.
- Grenze der Behebung: Die Regel greift dort, wo der Adapter eine Berechtigungsanfrage stellt. Der Rückfall `claude -p` gibt `mcp__citegeist` pauschal frei, siehe M4.
- Test: `packages/chat/src/policy.test.ts` (Blöcke „reading outside the library“ und „local files in citegeist tool calls“).

## Mittel

| Nr. | Befund | Empfehlung |
|---|---|---|
| M1 | **Agents mit Shell lesen das Token des Kerns.** Im nicht isolierten Chat (A11) kann der Agent `core.token` und `core.lock` lesen und den Kern ohne `x-citegeist-actor` als `human` ansprechen, also auch `settings.update`, `ai.testBackend` und `worker.setup`. Verhindern lässt sich das nicht, solange Agent und App unter demselben Benutzer laufen. Die Folge ist durch A11 bewusst in Kauf genommen. Die Nachvollziehbarkeit (D12) bleibt, `by:` zeigt dann aber `human` | Zwei Zugänge trennen: ein Token nur für den Renderer, das nie in eine Datei geschrieben wird (Weitergabe über IPC, bereits vorhanden), und ein Datei-Token für `cg`, dessen Akteur serverseitig auf `agent:cg` festliegt und `admin` nie erreicht. Zusätzlich vor `admin`-Operationen im Hauptprozess bestätigen lassen |
| M2 | **Keychain-Einträge sind für jeden Prozess des Benutzers lesbar.** Einträge, die das Werkzeug `security` anlegt, vertrauen nach üblicher Erfahrung dem Werkzeug selbst. Ein Agent mit Shell liest dann `security find-generic-password -s citegeist -a openai -w` ohne Rückfrage (auf einem Mac nachzuprüfen) | Einträge mit Zugriffsliste auf die App anlegen (`-T`) oder `safeStorage` von Electron verwenden. Für Webhook-Secrets und API-Schlüssel gleichermaßen |
| M3 | **Keine Content-Security-Policy im Renderer.** `apps/ui/index.html` setzt keine. Gegen einen Fehler im Filter (H1) hilft sie als zweite Schicht | `script-src 'self'` samt Hash für das Inline-Skript zur Themenwahl, `object-src 'none'`, `frame-src 'none'`, `connect-src` auf `http://127.0.0.1:*` und `ws://127.0.0.1:*`. Mit dem Playwright-Test der Desktop-App absichern |
| M4 | **Einschränkungen für Agents hängen am Adapter.** Dass ein Recherche-Agent keine lokalen Dateien einlesen lässt, prüft die Berechtigungsregel (H3). Die MCP-Token kennen nur `read` und `write`. Der Rückfall `claude -p` erlaubt `mcp__citegeist` pauschal, die Regel wird dort nicht gefragt. `items.add` und `items.attach` lesen lokale Pfade für jeden schreibenden Akteur | Eine Fähigkeit „lokale Dateien“ am MCP-Token führen und im Kern bei `items.add` und `items.attach` durchsetzen. Recherche-Sitzungen bekommen sie nie. `packages/ops/src/registry.ts` müsste dafür den Kontext erweitern, deshalb Sache des Leads |
| M5 | **SSRF in `items.add` für Agents und Connector.** Der Abruf einer URL (`packages/core/src/ingest/service.ts`, `get`) folgt Weiterleitungen und prüft weder Loopback noch private Bereiche. Die Größe wird nur über `Content-Length` begrenzt, ohne diese Angabe liest er unbegrenzt in den Speicher. Über Webhooks ist der direkte Fall behoben (H2) | Die Prüfung aus `remote-input.ts` für alle Akteure außer `human` auf Kern-Ebene anwenden, nach der Namensauflösung und bei jeder Weiterleitung. Den Datenstrom mit Obergrenze lesen |
| M6 | **Das Token einer MCP-Sitzung steht im Rückfall auf der Kommandozeile.** `print-driver.ts` übergibt `--mcp-config` mit dem Bearer-Token als Argument. Jeder Prozess des Systems sieht es mit `ps`. Es gilt nur für den MCP-Server auf Loopback und für diese Sitzung | Die Konfiguration in eine Datei mit Rechten 0600 im Arbeitsordner schreiben und den Pfad übergeben |
| M7 | **Sitzungs-Token werden nie entzogen.** `startChat` legt je Sitzung ein Schreib-Token an. Es bleibt bis zum Ende des Kerns gültig, das Feld `tokens` wächst | Das Token beim Schließen oder Löschen der Sitzung entfernen |
| M8 | **Electron-Härtung fehlt.** `hardenedRuntime: false`, ad-hoc-Signatur, keine Notarisierung, die Fuses `RunAsNode` und `NODE_OPTIONS` sind nicht abgeschaltet. IPC-Handler prüfen den Absender nicht (`event.senderFrame.url`) | Für den Release signieren und notarisieren, Fuses per `@electron/fuses` setzen, die Absender der Handler `citegeist:*` prüfen |
| M9 | **Das Token wird auch als Query-Parameter angenommen.** Das braucht nur der WebSocket und die Dateiroute (Bild und Frame können keine Header setzen), gilt aber für jeden Pfad. Es landet leicht in Protokollen | Query-Token nur für `/events` und `/files/` zulassen |

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
| Webhook-SSRF über Namen, die auf private Adressen zeigen, und über Weiterleitungen | bestätigt als Grenze von H2, geführt unter M5 |
| `read` und `search` mit einem absoluten Pfad nur in `pattern` oder `glob` umgehen die Lesebeschränkung | bestätigt und behoben: `policy.ts` prüft nun den festen Teil von `pattern` und `glob` und löst relative Pfade gegen den Arbeitsordner auf. Test in `policy.test.ts` |
| Token im Query-Parameter | geführt unter M9 |
| Connector ohne Token für lokale Prozesse ohne Origin | gewollt, weil das Protokoll des Zotero Connector kein Token kennt. Ein lokaler Prozess mit Zugriff auf `core.token` hätte ohnehin vollen Zugriff (M1). Der Connector ist standardmäßig aus |

Die Abdeckung des Laufs ist begrenzt. Die Befunde H1 bis H3 stammen aus der manuellen Durchsicht.
