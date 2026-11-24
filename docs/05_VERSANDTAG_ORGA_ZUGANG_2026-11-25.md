# Versandtag: separater Zugang für Orga (25.11.2026)

## Was die zweite Orga in SturmKnoten tun darf
- Bestellungen und die vollständige Versandanschrift ansehen; neue Bestellungen erfassen.
- CSV/Excel-Tabellenimport mit Feldzuordnung, Pflichtprüfung und Vorschau.
- Einnahmenübersicht ansehen, Zahlungen/Erstattungen dokumentieren.
- DIN-lang-Umschläge einzeln oder gesammelt drucken, echten Druck bestätigen.
- Mit eigener Anmeldung Tickets einer Bestellung per QR-Scan zuordnen, korrigieren, Verpackung bestätigen und den Versandstatus setzen.

## Was nicht freigegeben ist
- Keine Verwaltung der Access-Berechtigungen.
- Keine 700 Ticketcodes neu importieren.
- Keine Testbestellungen anlegen/löschen.
- Der Einsatz von Tickets am Einlass bleibt getrennt.

## Zugang muss vor dem Treffen noch eingerichtet werden
1. Die zweite Orga benötigt eine eigene E-Mail-Adresse und kann sich über Cloudflare Access mit Bestätigungscode anmelden.
2. Cloudflare Zero Trust → Access → Applications → **SturmKnoten 2027 – Verwaltung**. Neue **Allow**-Policy *SturmKnoten Versand & Finanzen* anlegen; **Include → Emails**: E-Mail der Orga eintragen. Die vorhandene Administrator-Policy unverändert lassen.
3. Cloudflare Workers & Pages → Worker **sturmknoten-2027** → Settings → Variables and secrets: normale Variable **DISPATCH_EMAIL** = exakt dieselbe E-Mail-Adresse (kleingeschrieben) hinzufügen; Production auswählen und deployen. **ADMIN_EMAIL**, **TEAM_DOMAIN** und **ACCESS_AUD** nicht ändern.
4. Zugang im privaten Browserfenster mit dem Konto der Kollegin testen. In der App sollte „Versandzugang“ stehen. Test: Bestellungen sehen, Daten und Zahlungen ansehen, **QR-Codes importieren darf NICHT angezeigt und vom Server nicht zugelassen werden**. Außerdem unter „CSV / Liste übernehmen“ prüfen, ob die Feldzuordnung öffnet.
5. **Keine realen Bestellungen erfassen, bevor Zugang, Rollenprüfung, Importvorschau und Druckablauf vor Ort gemeinsam überprüft sind.**

Keine Passwortweitergabe und keine WordPress-Administratorfreigabe nötig. Eine E-Mail-Adresse ist kein Passwort; trotzdem ist sie in Cloudflare einzutragen, nicht im GitHub-Repository.

## Versand-Ablauf
1. CSV-Datei oder aus Excel kopierte Tabelle über „CSV / Liste übernehmen“ einfügen.
2. Pflichtspalten Bestellnummer, Käufer, vollständige Anschrift, Gesamtbetrag sowie Ticketmengen zuordnen; **alle** Zeilen in Vorschau prüfen. **Ein Datensatz = eine Bestellung**, keine Einzelartikelzeilen. Änderungen an bereits importierten Bestellnummern werden nicht überschrieben.
3. Bei fehlender CSV: über „Neue Bestellung“ manuell erfassen.
4. Umschläge gesammelt drucken und nur tatsächlich gedruckte als gedruckt bestätigen.
5. Käufer am Handy öffnen; gedrucktes Ticket scannen und Mengen vergleichen, dann vollständig verpackt bestätigen.
6. Zahlung und Versandstatus dokumentieren; Versand erst mit vollständiger Zahlung und vollständiger Verpackung möglich.

## Grenzen / ehrliche Risiken
- Das tatsächliche wpShopGermany-Exportformat ist noch unbekannt. Spaltenzuordnung ist flexibel, aber Mehrfachzeilen pro Bestellung werden absichtlich blockiert, bis das Format geklärt ist.
- Preis und Porto werden **nicht aus aktuellen Ticketpreisen geschätzt**, sondern müssen im Export stehen bzw. manuell angegeben werden.
- Aus dem Export nur **explizit nachgewiesene Zahlungen** übernehmen; optional kann die Benutzerin bewusst festlegen, dass ein eindeutiger Status „Zahlung akzeptiert“ als bezahlt zählt.
- Die App kann nicht erkennen, ob ein Umschlag tatsächlich physisch durch den Drucker gegangen ist: Druckbestätigung ist manuell.
- Die zweite E-Mail ist noch NICHT bei Cloudflare Access freigegeben und **DISPATCH_EMAIL** noch NICHT gesetzt. Der Zugang ist bis dahin NICHT aktiv.
- Live-Tests unter der zweiten Identität und mit dem echten Shop-Export stehen aus.
