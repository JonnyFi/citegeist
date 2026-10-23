# citegeist Design-System "I"

Stand: Oktober 2026. Entschieden auf dem Design-Canvas (Boards I-Kombination, I-Bibliothek, I-Bibliothek-Spalte, I-Inbox, I-Uebersicht, I-Projekt, I-Agent, I-Dunkel). Die Tokens liegen in `apps/ui/src/styles.css`. Die acht Referenz-Mockups liegen als eigenständige HTML-Dateien (1280 x 820 px, Inline-Styles, Google-Fonts-Link nur für die Vorschau) in `docs/design/boards/`:

| Datei | Screen |
| --- | --- |
| `lesen-hell.html` | Quelle, Tab Lesen, Kartenspalte, Hellmodus (Leitscreen) |
| `lesen-dunkel.html` | derselbe Screen im Dunkelmodus |
| `lesen-agent-chat.html` | derselbe Screen mit Agent-Reiter in der rechten Spalte |
| `quelle-uebersicht.html` | Quelle, Tab Übersicht |
| `bibliothek.html` | Bibliothekstabelle mit Filterzeile |
| `bibliothek-spalte-offen.html` | Bibliothek mit ausgeklappter Leiste und Projektliste |
| `inbox.html` | Inbox mit Agent-Vorschlägen und Sammelaktionen |
| `projekt.html` | Projektansicht mit Brief, Forschungsfragen, Einstellungen |

Die Mockups sind die Quelle für Maße, Abstände und Zustände; die Tokens in `styles.css` sind die Quelle für Farben und Schriften. Bei Widerspruch gilt `styles.css`.

## Haltung

Bauhaus statt SaaS: weißer Grund, schwarze 1px-Linien als einziges Ordnungsmittel, keine Rundungen, keine Schatten, keine Farbflächen außer dort, wo etwas als Objekt erkennbar sein muss (Zitatkarten). Das Lesen hat Vorrang: Serif im Reader, 620px Zeilenmaß, Seitenzahlen am linken Rand. Agent-Inhalte sind erkennbar, aber leise: ein kleiner Stern, Modellname und Zeit in Monospace, nie eine eigene Farbe im Text.

## Farben

| Token | Hell | Dunkel | Verwendung |
| --- | --- | --- | --- |
| `bg` | `#ffffff` | `#151517` | Grund |
| `surface` | `#ffffff` | `#1c1c1f` | Karten, Blätter |
| `sunken` | `#f3f3f1` | `#0f0f11` | Kartenspalte, markierte Tabellenzeile, KI-Ebene in der Karte |
| `ink` | `#141414` | `#ececea` | Text, aktive Flächen |
| `muted` | `#5c5c5c` | `#a6a6ad` | Sekundärtext, Labels (hell 6,6:1, dunkel 7,5:1) |
| `line` | `#141414` | `#5a5a60` | Strukturlinien, Rahmen |
| `line-soft` | `#e4e4e4` | `#3a3a3e` | Tabellenzeilen, Trenner in Karten |
| `line-faint` | `#c4c4c4` | `#4a4a50` | Eingabefeld-Unterstrich, Chips zweiter Ordnung |
| `danger` | `#8a2130` | `#ff8a98` | Fehler, "ungeprüft" |
| `card-quote` | `#2f5fa8` | `#86b4ff` | Zitat |
| `card-finding` | `#8a2130` | `#ff8a98` | Befund |
| `card-definition` | `#5a6b12` | `#c9c25a` | Definition |
| `card-method` | `#1f6f8b` | `#6fc3dc` | Methode |
| `card-critique` | `#141414` | `#ececea` | Kritik |
| `card-comment` | `#7a5c00` | `#e0b84a` | Kommentar |
| `agent` | `#2f5fa8` | `#86b4ff` | Recherche-Fortschritt, Agent-Punkt |

Regeln: Aktiv ist immer `ink` auf `bg` invertiert (schwarzer Block mit weißem Text, im Dunkeln umgekehrt). Es gibt keinen Akzent neben den Kartenfarben. Die Kartenfarben unterscheiden sich in Helligkeit, nicht nur im Farbton, und tragen zusätzlich immer das Wort (Zitat, Befund, Definition), damit sie ohne Farbe lesbar bleiben.

## Schrift

- UI: Inter, 13px, Zeilenhöhe 1,4
- Lesen: Newsreader, 19px, Zeilenhöhe 1,55, Titel 30px Weight 500, Zwischentitel kursiv 19px
- Karten-Zitat: Newsreader 15px, Zeilenhöhe 1,45
- Technisches: JetBrains Mono 12px für Citekeys, Seitenangaben, Zähler, Pfade, Modellnamen
- Labels: Inter 11px, Weight 600, Versalien, Laufweite 0,1em

Die drei Schriften werden per `@fontsource` eingebunden (Electron läuft offline). Fallbacks stehen in den Tokens.

## Raster

- Kopfleiste 48px, darunter eine Unterleiste 44px pro Screen (Tabs, Filter, Aktionen)
- Icon-Leiste links 56px, ausgeklappt 240px; Klick auf den Pfeil in der Logo-Zelle, Zustand wird gemerkt
- Rechte Spalte 360px, nur auf Quelle und Projekt; Bibliothek und Inbox laufen über die volle Breite
- Tabellenzeilen 40px, Klickziele mindestens 44px
- Abstände in 4px-Schritten, bevorzugt 8, 12, 16, 24, 32
- Linien immer 1px, in Hell `ink`, in Dunkel `line`

## Bausteine

Switcher der rechten Spalte: zwei gleich breite Reiter, 44px hoch, Label in Versalien 11px, aktiver Reiter als invertierter Block, inaktiver mit linker Trennlinie. Links steht immer das Screen-eigene (Karten, Einstellungen), rechts immer Agent mit dem Namen des aktiven Agents in Monospace.

Zitatkarte: weiße Fläche mit 1px Rahmen auf `sunken`. Kopfzeile 32px mit 6px breitem Farbreiter links, Kartenart in Versalien in der Kartenfarbe, Belegstelle rechts in Monospace. Darunter drei getrennte Ebenen: Originalzitat in Serif, KI-Paraphrase auf `sunken` mit Stern, Modell und Zeit, "In meinen Worten" als Eingabefeld mit Unterstrich. Aktionen als geteilte Leiste am unteren Kartenrand. Zustände: "KI schreibt" als kursive Zeile mit Farbquadrat, "ungeprüft" als umrandeter Versalien-Stempel in `danger`, "nicht gefunden" als Stempel in `ink` mit gestrichelt-freier Karte und Link in den Reader.

Buttons: 26px (Unterleiste) oder 28px (Inhalt), 1px Rahmen, kein Radius, primär invertiert. Gruppen teilen sich die Rahmenlinie (zweiter Button ohne linken Rand).

Eingaben: in Leisten nur Unterstrich in `line`, in Inhalten 1px Rahmen. Chips: 1px Rahmen, 3px 8px Innenabstand, Tags zweiter Ordnung mit `line-faint`.

Markierungen im Text: Unterstreichung 2px in der Kartenfarbe mit 4px Abstand, nie eine Hintergrundfläche. Die aktuelle Auswahl bekommt `line-soft` als Fläche.

Herkunft: Stern-Glyph 10px plus "agent:name" in Monospace, Farbe `muted`. Agents bekommen keine eigene Farbe.

Hintergrundarbeit: ein Slot in der Kopfleiste rechts (Label in Versalien, 4px Balken, Zähler). Zeigt den wichtigsten Job; Klick auf den Zähler öffnet die Liste.

## Umsetzung

- Schriften per `@fontsource/inter`, `@fontsource-variable/newsreader` (oder `@fontsource/newsreader`) und `@fontsource/jetbrains-mono` einbinden; der Google-Fonts-Link in den Mockups ist nur Vorschau.
- `rounded-*`-Klassen in `apps/ui/src/components` entfernen; alle Radius-Tokens stehen auf 0.
- Icons: Lucide in 20px mit Strichstärke 1,5; keine gefüllten Icons.
- Aktive Navigationsflächen invertieren (`bg-ink text-bg`), kein Akzentton.
- Zustände, die die Mockups zeigen, sind vollständig: lädt, leer, keine Treffer, KI schreibt, KI fehlgeschlagen, ungeprüft, nicht gefunden, kopiert. Zustände, die ein Mockup nicht zeigt, folgen dem nächsten gezeigten (Fehler wie ungeprüft, leer wie Inbox-Leerzustand).

## Entscheidungen

- Die rechte Spalte wechselt ihre Rolle je Screen, sie wird nicht für Karten reserviert.
- Die Bibliothek zeigt immer Quellen (gefiltert nach Projekt). Der Projekt-Screen zeigt alles, was nicht Quelle ist: Brief, Fragen, Einstellungen, Export, Recherche. "Leseliste" im Projekt ist ein Link in die gefilterte Bibliothek, keine zweite Tabelle.
- Die Projektwahl liegt in der ausgeklappten Leiste unter "Bibliothek" und zusätzlich als Dropdown in der Filterzeile.
- Agent-Chat lebt im Switcher der rechten Spalte, mit Kontext-Chips oben und festem Composer unten. Auf Screens ohne rechte Spalte bleibt das Sprechblasen-Icon unten in der Leiste.
- Verworfen: Aktivitätsleiste am unteren Rand (F), Agent als Dialog im Text (J), eigene vierte Spalte (K), Agent aus der Kopfleiste (L), dezente Reiter und Register-Reiter (I-Switcher).
