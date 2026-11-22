# Ticketverwaltung – Migration 0001

Die Datei `0001_ticketverkauf.sql` ist die erste versionierte Datenbankstruktur für SturmKnoten 2027.

## Tabellen
- `customers`: Käufer, Anschrift und Kontakt
- `orders`: Bestellungen, Zahlung, Versand
- `tickets`: bereits gedruckte QR-Kennungen, Zuordnung, Einlass
- `scan_events`: Scan- und Doppel-Scan-Protokoll
- `audit_events`: Änderungsprotokoll

**Noch nicht produktiv einsetzen.** Diese Migration enthält nur die Struktur und wird durch Commit allein NICHT in der Cloudflare-D1-Datenbank ausgeführt.

## Geplanter Ablauf
1. Migration an einer leeren Test-Datenbank ausführen und prüfen.
2. Danach gezielt in `sturmknoten-2027-db` übernehmen.
3. Authentifizierung und Rollenrechte serverseitig umsetzen und testen.
4. Erst danach echte Käuferdaten oder Ticketcodes importieren.
5. Vor echten Verkäufen: Backup/Wiederherstellung, parallele Zuordnung, Einlass-Doppelscans und Umschlagdruck testen.

Cloudflare D1: `npx wrangler d1 migrations apply sturmknoten-2027-db --remote` (nur nach bewusster Freigabe und Datenbankprüfung).

Hinweis: Käufername und tatsächlicher Ticketinhaber können verschieden sein. Am Einlass wird nur die berechtigte Minimalansicht dargestellt, keine Postadresse.
