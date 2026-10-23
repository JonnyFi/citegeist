# citegeist: UI-Inventar als Briefing für das Design

Diese Datei beschreibt alle Oberflächen, Elemente und Zustände von citegeist. Sie dient als Hintergrund für einen Designentwurf. Der bisherige Look ist ein Platzhalter und darf komplett ersetzt werden. Funktionen und Zustände sind gesetzt, die Optik ist offen.

## Was citegeist ist

citegeist ist eine Literaturverwaltung für den Mac, in der Mensch und KI-Agents mit derselben Bibliothek arbeiten. Man sammelt Paper und Bücher, liest sie in der App, markiert Passagen als Zitatkarten mit Seitenangabe und verknüpft Gedanken zwischen Quellen. Agents wie Claude Code oder ein Grok-Bot können Paper hinzufügen, die Bibliothek durchsuchen und Recherchen erledigen.

Der Hauptnutzer bereitet ein PhD-Proposal vor (Sozialwissenschaft, deutsche und englische Quellen) und liest nebenbei technische KI-Paper. Er verbringt die meiste Zeit mit Lesen und Markieren. Die App soll sich anfühlen wie ein ruhiger Lesetisch und gleichzeitig zeigen, was Agents im Hintergrund tun.

## Rahmen

- Desktop-App für macOS (Electron), ein Fenster, typische Breite 1280 bis 1728 px, muss bis 1024 px funktionieren
- Hell, Dunkel und System
- Oberfläche auf Deutsch (Standard) und Englisch; deutsche Wörter sind lang, Layouts brauchen Platz dafür
- Tastaturbedienung überall, Fokuszustände sichtbar, WCAG 2.2 AA
- Bestehende Bausteine: React, Tailwind v4, shadcn/ui auf Base UI. Das Design darf eigene Tokens, Schriften und Komponenten festlegen

## Navigation (Shell)

- Seitenleiste mit: Bibliothek, Inbox (mit Zähler), Projekte, später Notizen, Graph und Startseite
- Globale Suche oben, durchsucht Quellen, Karten, Notizen und Volltext-Passagen
- Unten in der Leiste: Name der geöffneten Bibliothek, Einstellungen, Hell/Dunkel, Sprache
- Ein Hintergrund-Indikator zeigt laufende Jobs (Konvertierung, KI schreibt, Recherche), mit Fortschritt
- Später rechts eine ausklappbare Chat-Seitenleiste für Agents

## Screens in v0.1

### Willkommen

Erscheint, wenn keine Bibliothek offen ist. Aktionen: „Bibliothek öffnen“ (Ordnerdialog) und „Neue Bibliothek“.

### Ersteinrichtung

Drei Schritte: Bibliothek anlegen oder öffnen, KI-Backend wählen und testen, Konvertierungs-Umgebung installieren.
- Backend-Auswahl zeigt pro Option Status (installiert, eingeloggt, nicht gefunden) und einen Testknopf mit Ergebnis (Latenz in Sekunden oder Fehler mit konkretem Lösungsschritt)
- Optionen: Claude Code, Codex, Cursor (eigenes Abo), API-Key (Anthropic, OpenAI, OpenRouter, xAI), lokales Modell (Ollama)
- Installation der Python-Umgebung mit Fortschrittsanzeige, dauert beim ersten Mal mehrere Minuten (Modelle laden etwa 1 GB)

### Bibliothek

Tabelle aller Quellen mit Spalten Titel, Autoren, Jahr, Typ, Lesestatus. Filter für Projekt und Lesestatus, Trefferzahl, „Mehr laden“.
- Zustände: lädt, leer („Deine Bibliothek ist leer“ mit Hinweis auf Drag and Drop, DOI einfügen), keine Treffer für Filter
- Hinzufügen: PDF ins Fenster ziehen, DOI, arXiv-Link, ISBN oder URL einfügen. Danach erscheint die Quelle sofort und füllt sich, während Metadaten und Konvertierung im Hintergrund laufen
- Quellen-Typen: Artikel, Buch, Kapitel, Bericht, Abschlussarbeit, Webseite, Datensatz und weitere

### Quelle (Item-Ansicht)

Zwei Tabs: „Übersicht“ und „Lesen“.

**Übersicht:**
- Titel, Autoren, Jahr, Abstract
- Metadaten: Typ, erschienen in, Verlag, Band, Heft, Seiten, Sprache, Citekey (z. B. `luhmann1984soziale`, technisch, gut als Monospace), Tags, Projekte
- Literaturnotiz (freier Markdown-Text)
- Liste der Zitatkarten dieser Quelle
- Herkunftsmarke, wenn ein Agent die Quelle vorgeschlagen hat: „Vorgeschlagen von agent:grok: passt zu Forschungsfrage 2“

**Lesen (Reader):**
- Umschalter „PDF“ und „Text“. Die PDF-Ansicht zeigt das Original mit Seiten; die Textansicht zeigt den konvertierten, umgebrochenen Text mit Überschriften, Formeln und Tabellen, angenehm lesbar wie ein Artikel
- Seitenmarken auch in der Textansicht (gedruckte Seitenzahl am Rand), weil Zitate Seiten brauchen
- Dropdown „Sprache der KI-Texte“: zeigt die geltende Sprache und woher sie kommt (Quelle, Projekt, Bibliothek), änderbar für diese Quelle
- Markierungen (Karten) erscheinen in beiden Ansichten an derselben Stelle, farblich nach Kartenart
- Text markieren öffnet ein kleines Menü an der Auswahl: „Zitat“, „Erklären“, „Mit Notiz verknüpfen“ (die letzten beiden kommen in v0.2 und sind vorerst deaktiviert)
- Kartenpanel rechts neben dem Text mit allen Karten der Quelle, Klick auf eine Karte springt zur Stelle
- Banner „Seitenzahlen prüfen“, einmal pro PDF: „PDF-Seite 12 trägt die gedruckte Nummer 215“ mit „Bestätigen“ und „Korrigieren“

### Zitatkarte (Kernelement)

Die Zitatkarte ist das wichtigste Objekt der App und braucht das sorgfältigste Design.
- Wortlaut der Passage (unveränderlich, klar als Originalzitat erkennbar)
- Seitenangabe, z. B. „S. 31“ oder „S. 31 f.“
- Art: Zitat, Befund, Methode, Definition, Kritik, Kommentar
- Paraphrase und Kernaussage, von der KI geschrieben, sichtbar als KI-Text markiert (mit Modell und Zeitpunkt)
- „In meinen Worten“ und Kommentar, frei editierbar
- Tags, Projekte
- Aktionen: „Als direktes Zitat kopieren“, „Als indirektes Zitat kopieren“ (Ergebnis z. B. „Luhmann (1984, S. 31)“ beziehungsweise „vgl. Luhmann 1984, S. 31“), „Neu schreiben“ mit Sprachwahl, „Im Reader zeigen“
- Zustände:
  - **KI schreibt:** die Karte steht sofort, Paraphrase und Kernaussage erscheinen etwa 4 bis 6 Sekunden später
  - **KI fehlgeschlagen:** mit Erneut-Knopf
  - **Seite ungeprüft:** die gedruckte Seitenzahl ist noch nicht bestätigt
  - **Markierung nicht gefunden:** nach einer Neukonvertierung ließ sich die Stelle nicht wiederfinden
  - **Kopiert:** kurze Bestätigung

### Inbox

Liste der Quellen, die Agents hinzugefügt haben und die auf Annahme warten.
- Pro Eintrag: Titel, Autoren, Jahr, „Hinzugefügt von agent:grok“, Begründung des Agents
- Annehmen und Verwerfen einzeln, Mehrfachauswahl mit „Alle auswählen“, „Ausgewählte annehmen (3)“
- Leerzustand: „Die Inbox ist leer. Paper, die Agents für dich finden, warten hier, bis du sie annimmst.“

### Projekte

- **Liste:** Name, Status (aktiv, pausiert, abgeschlossen), Anzahl Forschungsfragen
- **Projektansicht:**
  - Projektbrief (längerer Markdown-Text mit Ziel, Fragestellung, Abgrenzung; Agents lesen ihn vor jeder Aufgabe), editierbar
  - Forschungsfragen
  - Leseliste mit Status
  - Sprache der KI-Texte
  - Zitierstil
  - Export als `.bib` und CSL-JSON

### Suche

Ergebnisliste nach Art gekennzeichnet (Quelle, Karte, Notiz, Textstelle), mit Ausschnitt, hervorgehobenem Treffer und Seitenzahl bei Textstellen. Zustände: leer mit Einladung, lädt, nichts gefunden.

### Einstellungen

- KI-Backends mit Status und Testknopf
- Zuordnung pro Aufgabe („Paraphrase“, „Metadaten erkennen“, „Recherche“ und weitere, Standard für alle)
- API-Keys (liegen in der macOS-Keychain)
- Sprache der Oberfläche
- Kontaktadresse für Metadaten-Dienste
- Konvertierungs-Umgebung: Status, installierte Werkzeuge, Installieren oder Aktualisieren

## Screens für v0.2 und v0.3, die das Design mitdenken sollte

- **Notiz-Editor:** Markdown mit Live-Vorschau wie in Obsidian, Wiki-Links `[[luhmann1984soziale]]` mit Autovervollständigung, eingebettete Zitatkarten, Backlinks
- **Vorgeschlagene Verbindungen:** Nach dem Schreiben schlägt die KI typisierte Verbindungen vor (stützt, widerspricht, präzisiert, bezieht sich auf Frage, erweitert, nutzt Methode von, nutzt Daten von, führt fort, verwandt), jeweils mit Begründung und belegender Karte; annehmen oder verwerfen
- **Verbindungspanel** pro Quelle und **Graph-Ansicht** über die Bibliothek, filterbar nach Verbindungstyp
- **Startseite „Alles Gelesene“:** zuletzt gelesen und markiert, neue Verbindungen, offene Fragen, über alle Projekte
- **Chat-Seitenleiste:** Agent-Auswahl (Claude Code, Codex, Cursor, externe Agents), Kontext-Chips für aktuelles Dokument, Markierung und Projekt, Antworten mit klickbaren Belegen (Karte, Seite)
- **Recherche-Jobs:** Auftrag, Fortschritt, Ergebnisse landen in der Inbox
- **Quick-Insert:** schwebende Suchpalette per globalem Hotkey über jeder App (wie Spotlight), Karte suchen, Zitat mit Beleg einfügen
- **Literaturmatrix:** Tabelle Quellen mal Spalten (Fragestellung, Methode, Befund, Grenzen), jede Zelle mit Beleg
- **Schneeballsuche:** Referenzen und zitierende Arbeiten einer Quelle, markiert, was schon in der Bibliothek ist

## Wiederkehrende Elemente

- **Herkunft:** Wer etwas angelegt hat (du, ein benannter Agent, ein Modell) zeigt eine kleine, ruhige Marke; Agent-Inhalte sollen erkennbar, aber nicht laut sein
- **KI-Texte:** immer als solche erkennbar, getrennt vom Originalzitat und von den eigenen Worten
- **Seitenangaben:** häufig, kurz, oft am Rand
- **Citekeys:** technische Kennungen, Monospace
- **Hintergrundarbeit:** Konvertieren, KI schreibt, Recherche läuft; Zustände dezent und nachvollziehbar
- **Leer-, Lade- und Fehlerzustände** gibt es überall; Fehler nennen immer, was zu tun ist

## Leitplanken

- Das Lesen hat Vorrang: lange Texte, gute Lesetypografie, wenig Ablenkung im Reader
- Die Tabelle der Bibliothek darf dicht sein, der Reader großzügig
- Akademisch und warm statt kühlem SaaS-Look
- Die Kartenarten brauchen gut unterscheidbare Farben, die in Hell und Dunkel funktionieren und auch ohne Farbe unterscheidbar bleiben
