# Wärmepumpe: Stiebel ISG über Modbus TCP

Die Wärmepumpe hängt an einem Regler **WPMsystem** (Regler-Software 449) mit Erweiterung WPE und Bedienteilen FES/FET. Die ISG (ISG web, Software 12.x) gibt die Werte des Reglers über Modbus TCP aus. Der Collector liest sie mit dem Adapter `isg` (`apps/collector/src/adapters/isg.ts`) und übersetzt sie in `packages/domain/src/isg.ts`.

Die Zuordnung wurde am 20.11.2026 an der eigenen Anlage gegen die lokale SERVICEWELT (`http://servicewelt`) geprüft. Grundlage ist die Stiebel-Doku „Modbus TCP/IP“. Register über 608 und die Zähler ab 3501 stehen dort nicht oder nicht vollständig, sie sind durch Vergleich mit der SERVICEWELT ermittelt.

## Zugriff

- Port 502, Unit-ID 1, nur Funktion 04 (Input-Register lesen). Der Adapter schreibt nie.
- Registernummern sind 1-basiert: Protokolladresse = Registernummer − 1.
- Register ab 801 bis 2500 gibt es nicht (Ausnahme 2).
- Sonderwerte: `0x8000` = nicht vorhanden, `0x9000` = aus. Der Adapter verwirft alles von `0x8000` bis `0x9FFF`.

## Gelesene Werte

Faktor: Rohwert × Faktor = Wert. „Paar“ heißt: zweites Register = Tausender, erstes = Rest (0–999), Wert = Tausender × 1000 + Rest.

| Register      | Größe (`readings.quantity`)                                                    | Faktor | Einheit | Bedeutung (SERVICEWELT)                              |
| ------------- | ------------------------------------------------------------------------------ | ------ | ------- | ---------------------------------------------------- |
| 507           | `temp_outdoor_c`                                                               | 0,1    | °C      | Außentemperatur                                      |
| 508 / 510     | `temp_hc1_c` / `temp_hc1_set_c`                                                | 0,1    | °C      | Heizkreis 1 Ist / Soll                               |
| 511 / 512     | `temp_hc2_c` / `temp_hc2_set_c`                                                | 0,1    | °C      | Heizkreis 2 Ist / Soll                               |
| 610 / 611     | `temp_hc3_c` / `temp_hc3_set_c`                                                | 0,1    | °C      | Heizkreis 3 Ist / Soll                               |
| 612 / 613     | `temp_hc4_c` / `temp_hc4_set_c`                                                | 0,1    | °C      | Heizkreis 4 Ist / Soll                               |
| 518 / 519     | `temp_buffer_c` / `temp_buffer_set_c`                                          | 0,1    | °C      | Puffer Ist / Soll                                    |
| 522 / 523     | `temp_dhw_c` / `temp_dhw_set_c`                                                | 0,1    | °C      | Warmwasser Ist / Soll                                |
| 542 / 543     | `temp_return_c` / `temp_flow_c`                                                | 0,1    | °C      | Rücklauf / Vorlauf Wärmepumpe 1                      |
| 544           | `temp_hot_gas_c`                                                               | 0,1    | °C      | Heißgastemperatur                                    |
| 545–547       | `pressure_low_bar` / `_mid_bar` / `_high_bar`                                  | 0,01   | bar     | Nieder-, Mittel-, Hochdruck                          |
| 548           | `flow_rate_lpm`                                                                | 0,1    | l/min   | WP-Wasservolumenstrom                                |
| 584 + 4·(n−1) | `temp_room{n}_c`, `_set_c`, `humidity_room{n}_pct`, `temp_room{n}_dew_point_c` | 0,1    | °C / %  | Raum Heizkreis n (1–5): Ist, Soll, Feuchte, Taupunkt |
| 2501          | `status_bits`                                                                  | 1      | –       | Betriebsstatus als Bitfeld (Bits noch offen)         |
| 3502 + 3503   | `counter_heat_heating_kwh`                                                     | Paar   | kWh     | Wärmemenge Heizen, Summe                             |
| 3505 + 3506   | `counter_heat_dhw_kwh`                                                         | Paar   | kWh     | Wärmemenge Warmwasser, Summe                         |
| 3507 + 3508   | `counter_heat_backup_heating_kwh`                                              | Paar   | kWh     | Nachheizstufe (NHZ) Heizen, Summe                    |
| 3509 + 3510   | `counter_heat_backup_dhw_kwh`                                                  | Paar   | kWh     | Nachheizstufe (NHZ) Warmwasser, Summe                |
| 3512 + 3513   | `counter_power_heating_kwh`                                                    | Paar   | kWh     | Leistungsaufnahme Heizen, Summe                      |
| 3515 + 3516   | `counter_power_dhw_kwh`                                                        | Paar   | kWh     | Leistungsaufnahme Warmwasser, Summe                  |
| 3644 / 3645   | `counter_runtime_heating_h` / `_dhw_h`                                         | 1      | h       | Laufzeit Verdichter Heizen / Warmwasser              |
| 3680          | `power_inverter_w`                                                             | 100    | W       | Inverter-Aufnahmeleistung (0,1 kW Auflösung)         |
| 3727 / 3733   | `efficiency_heating_12m` / `efficiency_dhw_12m`                                | 0,01   | –       | Effizienz der letzten 12 Monate                      |
| 3740 + 3741   | `counter_compressor_starts`                                                    | Paar   | –       | Verdichterstarts                                     |

Alle Werte werden unter der Messstelle `waermepumpe` mit der Quelle `isg` gespeichert, Zeitstempel ist der Abfragezeitpunkt.

## Bekannt, aber nicht gespeichert

| Register               | Bedeutung                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| 3501, 3504, 3511, 3514 | Tageswerte Wärme bzw. Strom (Heizen, Warmwasser), nur ganze kWh. Tageswerte werden aus den Summen berechnet. |
| 3523–3538              | Wiederholung von 3501–3516, vermutlich für „Wärmepumpe 1“                                                    |
| 3545–3548              | Laufzeiten Kühlen oder Abtauen (gleicher Wert, noch nicht unterscheidbar), NHZ 1, NHZ 2, NHZ 1/2             |
| 3690–3725              | Statistik „1–24 h“ (rollierend), „1–12 M“, „13–24 M“ für Wärme und Strom, je als Paar                        |
| 3726, 3728, 3732, 3734 | Effizienz 24 h und 13–24 Monate                                                                              |
| 604–607                | Raum-Soll der Kühlkreise 1–4                                                                                 |

## Offen

- **Bits im Betriebsstatus 2501** (Heizen, Warmwasser, Kühlen, Verdichter, Abtauen). Ermitteln durch Vergleich der gespeicherten `status_bits` mit dem Betrieb.
- **Strom für Kühlen:** Die Plätze für Kühlen in der Statistik (3696–3701, 3714–3719, 3729–3731) sind leer. Ansatz: Inverter-Leistung über die Zeit aufsummieren und die Zunahme von Strom Heizen und Strom Warmwasser abziehen. Alternative: MID-Zähler im WP-Kreis (offener Punkt O1).
- **Genauigkeit:** Wärmemengen und Stromaufnahme berechnet der Regler, sie sind nicht geeicht gemessen.
- Nicht über Modbus verfügbar: Verdichterdrehzahl, Lüfterleistung, Verdampfer-, Ölsumpf- und weitere Prozesstemperaturen, Abtau-Starts.
