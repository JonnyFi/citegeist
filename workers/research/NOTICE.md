# Herkunft

`workers/research` stammt aus der research-pipeline (`nofreeWyfy/research-pipeline`, Commit `f94047a`), mit Zustimmung des Teams nach citegeist übernommen (Issue #50).

Geändert gegenüber dem Original:

- Ohne Weboberfläche (`gui/`), Launcher, scite (`scite.py`), eigene Literaturmatrix (`matrix.py`) und Leseliste (`readinglist.py`). citegeist hat dafür Inbox, Bibliothek, Literaturmatrix und Rückruf-Warnungen.
- `scripts/settings.py` liest die Ordner nur aus `CITEGEIST_LITSEARCH_DIR` (`<Bibliothek>/research`) und `CITEGEIST_LITSEARCH_CACHE`; ohne Bibliothek startet kein Skript. Ohne gesetztes `SSL_CERT_FILE` gelten die macOS-Systemzertifikate (`/etc/ssl/cert.pem`).
- `scripts/papers.py` enthält die Hilfsfunktionen aus `matrix.py`, die Beobachtungen und opendraft-Übergabe brauchen.
- Die opendraft-Übergabe nutzt die OpenAlex-Abstracts statt der Matrix-Zusammenfassungen.

`vendor/opendraft` steht unter der Apache License 2.0 (`vendor/opendraft/LICENSE`, `vendor/opendraft/THIRD_PARTY_NOTICES.md`).
