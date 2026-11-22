# SturmKnoten 2027 – Sammeldruck & Packliste

## Ablauf

1. Bestellungen per CSV/Excel (nach Klärung mit wpShopGermany) oder manuell erfassen.
2. Unter **Umschläge gesammelt drucken** offene Umschläge auswählen.
3. Sammeldruck: DIN-lang, **eine Adresse pro Umschlag**.
4. **Erst nach dem tatsächlichen Druck** bestätigst du, welche Umschläge erfolgreich gedruckt wurden. Fehlende/abgebrochene bleiben automatisch „Nicht gedruckt“.
5. Beim Verpacken Namen auswählen, Ticketarten und Soll-/Ist-Mengen ansehen, QR-Codes der **gedruckten** Tickets zuordnen. Erst wenn alle korrekt sind: **Verpackt bestätigen**.
6. Zahlung muss vollständig sein und Verpackung bestätigt sein, bevor **Versand** markiert werden kann.

Status: **Nicht gedruckt**, **Gedruckt**, **Verpackt**, **Versendet**. Ein tatsächlicher Druck lässt sich aus dem Browser nicht sicher feststellen, deshalb ist die Bestätigung manuell und korrigierbar.

## Einmalige D1-Erweiterung – noch auszuführen

Datei: [03_D1_KONSOLE_UMSCHLAEGE.sql](./03_D1_KONSOLE_UMSCHLAEGE.sql)

In Cloudflare > D1 SQL Database > sturmknoten-2027-db > Console einmal ausführen. Die SQL-Datei verwendet CREATE TABLE IF NOT EXISTS, verändert keine alten Datensätze und benötigt die bisherigen Tabellen.
Kontrolle mit `/tables`: Tabelle `envelope_progress`.

**Bis dahin den neuen Sammeldruck nicht mit echten Kundendaten verwenden.**

## Getestet

- JavaScript-Syntax von Backend und Frontend kontrolliert.
- SQLite-Szenariotests: Sammeldruck-Audit, keine Bestätigung einer bereits versendeten Bestellung, Verpackungsbestätigung scheitert bei fehlenden Tickets, funktioniert bei vollständig gescannten Tickets.
- **Noch nicht getestet:** Produktions-D1 mit Erweiterung; Cloudflare-Zugang nach Deploy; browserbasierter Sammeldruck mit Epson ET-2865, echte DL-Umschläge; Scan mit dem Handy.

## Nicht Teil dieser Ergänzung

- wpShopGermany-Bestellexport/-import (abhängig von tatsächlichem Exportprofil)
- Automatische Preisübernahme
- Benutzerkonten für andere Organisatoren
- **Testbestellung mit Löschfunktion vorhanden:** Über „Neue Bestellung“ → „Testbestellung Max Mustermann anlegen“ wird 1 Matrosen-Ticket vorgegeben. Nach der Test-Zuordnung über „Testbestellung löschen und Ticket freigeben“ wird das Ticket wieder verfügbar. Bezahlte, versendete oder am Einlass benutzte Tickets dürfen nicht automatisch freigegeben werden.

Die 700 gedruckten Ticketcodes bleiben unverändert. Sammeldruck/Verpackung löst keine Einlassentwertung aus.

## Demo-Test (ohne echten Käufer)

- Der Button erstellt einen Beispieldatensatz: Max Mustermann, Musterstraße 12, 12345 Musterstadt, Ticketart Matrosen, Menge 1, Betrag 0 €.
- Der Datensatz trägt die interne Kennung `internal_test`; normale Bestellungen können diesen Kennwert nicht setzen.
- Der Test kann ein echtes, noch unvergebenes QR-Ticket vorübergehend zuordnen. Vor dem nächsten Live-Verkauf unbedingt wieder die Testbestellung löschen und den Zähler auf 0 prüfen.
- Die Löschfunktion ist ausschließlich für diese Demo-Bestellung freigegeben; sie löst ihre Ticketzuordnungen und entfernt den fiktiven Kunden. Die 700 importierten QR-Codes bleiben bestehen. Zahlungs-, Versand- und Einlassdaten blockieren die automatische Löschung.
- Die vollständige Verpackungsprüfung benötigt weiterhin die noch auszuführende D1-Erweiterung `03_D1_KONSOLE_UMSCHLAEGE.sql`.
- **Code geprüft, aber Produktionsablauf mit echten Mobilgeräten nach diesem Update noch nicht getestet.**
