# SturmKnoten 2027 – Verkaufsstellen und einheitlicher Einlass

## Festgelegte Architektur (25.11.2026)
- **SturmKnoten ist der einzige Einlass-Scanner.** Die Ditix-Scan-App wird nicht für Besucher-Einlass eingeplant.
- **Gedruckte Hardtickets:** Die bereits importierten 700 QR-Codes (500 Kombi, 100 Matrosen, 100 Seemann) bleiben unverändert.
- **Digitale Onlinetickets:** Ditix verkauft und versendet digitale Tickets mit einem eigenen, getrennten Ticketcode-Bestand. Wir erstellen **keine zusätzlichen QR-Codes für ein Ditix-Ticket**, solange nicht gesichert ist, dass sie auf dem ausgelieferten Ticket erscheinen.
- **Ditix → SturmKnoten:** Die offizielle Ditix-Ticketliste enthält den Ticketcode, Ticketart und Status. Zusätzlich gibt es Bestell-Webhooks mit Ticketcodes. Diese sind mögliche Übertragungswege – die Datensicherheit, Aktualisierungen und das konkrete Format müssen vor Implementierung getestet werden.
- **Gültigkeit:** Ein digitaler Code darf am Einlass erst nach bestätigter Zahlung und nicht nach Stornierung akzeptiert werden. Änderungen bei Ditix müssen in SturmKnoten synchronisiert sein. Bei nicht verifizierbarem Stand keine ungeprüfte Freigabe.
- **Einlass:** Ein gemeinsamer Strom aus Hardtickets + digitalen Ditix-Tickets. Scanner erhält serverseitig die Antworten: gültig / bereits gescannt (mit erstem Scanzeitpunkt) / ungültig (inkl. Sperre/Storno/Unbekannt). Tickets pro Festivaltag bzw. Mehrtagesrechte später separat definieren.
- **Einlass-Rollen:** Noch nicht gebaut. Vor Live-Einsatz Scanpersonal-Accounts mit Einlass-Rechten einrichten, getrennt vom Versand-/Finanzzugang. Einlass-Scans müssen konkurrierenden Zugriff sicher behandeln (atomare Erstbuchung) und protokolliert sein.
- **Offline:** Nicht versprechen, dass mehrere Scanner offline Dopplungen zuverlässig erkennen. Erst nach Konzeption und Tests.

## Bereits im Quellcode ergänzt: physische Ticket-Ausgabe an Verkaufsstellen
- Neue geschützte Oberfläche `/verkaufsstellen.html`: Verkaufsstelle anlegen (z. B. Tankstelle), auswählen, Hardtickets per Smartphone-Kamera/QR-Foto/Code scannen, wieder zurücknehmen und den Bestand je Verkaufsstelle sehen.
- Neue geschützte Datenbanktabellen `sales_points` und `sales_point_tickets`. Werden beim ersten autorisierten Zugriff angelegt.
- Tickets, die bei einer Verkaufsstelle liegen, dürfen **nicht zusätzlich** einer Käufer-Versandbestellung zugeordnet werden. Eingebaute Sperre in der SQL-Zuweisung, nicht nur in der Oberfläche.
- Ausgabe ist **weder Verkauf noch Einlass**. Zurücknahme gibt das Ticket für die weitere Ausgabe/Zuordnung frei. Jede Bewegung wird in `audit_events` mit Person (Cloudflare E-Mail) protokolliert.
- Im Bereich „QR sicher testen“ ist die Verkaufsstelle sichtbar. Es werden bei der Prüfung keine Bestände geändert.
- Die zweite Orga-Rolle „Versand & Finanzen“ kann Verkaufsstellen bedienen, aber keine QR-Mastercodes importieren.
- **Noch nicht mit echten Geräten und Produktionsdaten getestet**: Benutzerrolle, Kamera-Dauerscan, Datenbanktabellen-Anlage, Ausgabe/Rücknahme, Verhinderung einer Doppel-Zuordnung. Erst an einem unzugeordneten echten Hardticket testen, dann dessen Rücknahme kontrollieren.

## Ditix-Quellen
- Ticketlisten exportieren: https://help.ditix.io/de/articles/10627260-ticketlisten-exportieren
- Bestell-Webhook mit Ticketcodes: https://help.ditix.io/de/articles/11583970-webhook-bestellung-erstellt-order_created
- Status und Zahlung: https://help.ditix.io/de/articles/10515631-status-der-bestellungen-und-ihre-bedeutung

## Offene Punkte
1. Ein digitales Muster-Ticket aus Ditix herunterladen; prüfen, welchen Code die QR-Grafik tatsächlich trägt und wie die Ticketlisten-CSV aufgebaut ist.
2. Sync-Art entscheiden: CSV-Übernahme zu Beginn, danach ggf. signierter/Webhook-basierter Abgleich inkl. Storno und Zahlungsstatus. Nie allein auf `order_created` vertrauen.
3. Ticketarten und Gültigkeitstage definieren sowie Einlass-Endpunkt und eigene Scan-Oberfläche bauen.
4. Mehrere Scanner, Berechtigungen und echte Doppel-Scans testen. 
