# SturmKnoten 2027 – Ticketverkauf und Versand (Stand 22.11.2026)

## Bereits im Code umgesetzt

- Geschützte Admin-Oberfläche für Bestellungen und Versand (Cloudflare Access)
- Käufername, Anschrift, bestellte Ticketart und Ticketanzahl
- Import der **700** ursprünglichen QR-URLs direkt im geschützten Browser
- Zuordnung eines gedruckten Tickets zur ausgewählten Bestellung durch Kamera, QR-Foto oder manuelle Eingabe
- Prüfung auf gleiche/andere Bestellung, falsche Ticketart und Mengenüberschreitung
- Zahlungseingänge und Erstattungen mit Betrag, Zahlungsweg und Vermerk
- DIN-lang-Briefumschlagdruck mit Empfängeranschrift (Druckertest noch offen)
- Versandbereit / versendet nur bei vollständiger Zuordnung und bezahltem Auftrag
- Änderungsprotokoll

## Nächste einmalige Einrichtung bei Cloudflare

**Noch keine echten Kundendaten eintragen**, bevor die Punkte abgeschlossen und getestet sind.

1. In **D1 > sturmknoten-2027-db > Console** die [Zusatz-SQL-Datei](../docs/02_D1_KONSOLE_VERKAUF.sql) (Raw ohne Kommentare) genau einmal ausführen. Sie fügt die Mengenfelder in `orders` und die Tabelle `payments` hinzu.
2. Danach mit `/tables` prüfen, dass `payments` existiert, und mit `PRAGMA table_info(orders);` kontrollieren, dass `qty_kombi`, `qty_matrosen`, `qty_seemann` vorhanden sind. **Nicht erneut ausführen**, sobald die Felder angelegt sind.
3. In **Workers & Pages > sturmknoten-2027 > Settings > Variables and Secrets** drei Werte ausschließlich direkt in Cloudflare eintragen:
   - `TEAM_DOMAIN`: die vollständige Zero-Trust-Team-Adresse, z. B. `https://BEISPIEL.cloudflareaccess.com` (eigene Adresse unter Zero Trust > Settings finden).
   - `ACCESS_AUD`: Audience Tag der Access-Anwendung „SturmKnoten 2027 – Verwaltung“ (Zero Trust > Access controls > Applications > Anwendung > Additional settings).
   - `ADMIN_EMAIL`: die genaue Admin-E-Mail, die in der Access-Regel freigegeben ist.
   - **Diese persönlichen Werte nicht im Chat und nicht in GitHub veröffentlichen.**
4. Neue Worker-Bereitstellung kontrollieren; im Browser unter `/api/me` darf nur die freigeschaltete Person Erfolg erhalten. Ohne Login bzw. mit fremdem Account muss Access blockieren.
5. CSV-Datei **direkt in der geschützten App** importieren; Bestandszahlen auf 500 Kombi, 100 Matrosen, 100 Seemann prüfen.
6. Praxistest: gedruckter QR-Code mit Handy scannen; Zahlungseingang, Umschlagdruck auf Papier und nachfolgend am tatsächlichen Briefumschlag sowie Versandstatus prüfen.
7. Vor Betrieb Backup- und Wiederherstellung prüfen; Datenschutzhinweise, Aufbewahrungs-/Löschfristen und den Cloudflare-Auftragsverarbeitungsvertrag für die echte Nutzung klären.

## Sicherheit / Abgrenzung

- **Keine** Kundendaten oder Ticketcodes im öffentlichen Repository.
- Ein QR-Code führt öffentlich weiterhin nur zur Festival-Infoseite; die interne Zuordnung ist nur über die abgesicherte Admin-App abrufbar.
- Die API validiert die signierte Cloudflare-Access-Identität zusätzlich und lässt nur die fest konfigurierte Admin-E-Mail zu; ohne diese Konfiguration bleibt die API gesperrt.
- Der Scan beim Verpacken ist **keine Einlassentwertung**. Die Einlass-App und Mitarbeiterpässe werden später separat ergänzt.
- Aktuell keine echte Synchronisation oder Offline-Verfügbarkeit für Einlass-Tablets.
- Die Browser-Kamerafunktion benötigt `BarcodeDetector`; auf nicht unterstützten Geräten ist vorerst die manuelle Eingabe oder QR-Foto-Alternative vorgesehen.
- Testfälle auf Entwicklungsdatenbank ausgeführt, aber Produktionsdatenbank, Echtgeräte und Druck noch **nicht** abgenommen.

## GitHub

`public/index.html`, `public/app.js`, `public/style.css`, `src/index.js`, `wrangler.jsonc`, `migrations/0002_sales_dispatch.sql`.
