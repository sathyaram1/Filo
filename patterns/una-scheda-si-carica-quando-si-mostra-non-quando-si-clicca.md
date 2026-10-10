# Una scheda si carica quando si mostra, non quando si clicca

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Il caricamento pigro di una scheda (leggere il log, i modelli, le
fusioni, le statistiche) si aggancia al momento in cui la scheda **diventa
visibile**, da qualunque strada ci si arrivi, non al clic sul suo bottone. Un
punto solo che mostra le schede, e da lì un avviso che i caricamenti ascoltano.

## Il caso che l'ha fatta nascere

La barra di Gestione era piatta: dieci bottoni, e ogni caricamento pigro era un
ascoltatore del clic sul proprio bottone («clic su Log → rileggi il log»).
Finché l'unico modo di aprire una scheda era cliccarla, reggeva.

Con le sezioni (#1150) una scheda si apre anche:

- cliccando la sua **sezione**, che riapre l'ultima scheda di quella sezione;
- all'**apertura della pagina**, che torna sull'ultima sezione usata;
- da un **salto** (un avviso che porta a una segnalazione, le statistiche che
  aprono la riga giusta, la lente che riporta alla lista).

Nessuna di queste strade clicca il bottone della scheda. Riaprendo Gestione su
«Routine → Log» si vedeva il pannello del log fermo su «Caricamento…» per
sempre, e lo stesso valeva per Modelli e Automazioni: il pannello c'era, i dati
no, e niente diceva perché.

## Come si fa

- `selectTab(tab)` è l'unica porta che mostra una scheda: accende la sezione,
  il bottone e il pannello, e alla fine manda `mg-scheda` con `{ tab, apertura }`.
- Ogni caricamento pigro ascolta `mg-scheda` (anche quelli in file separati,
  come il Red Team), non il clic.
- `apertura` dice che a mostrare la scheda è stata la scelta automatica
  d'avvio: chi ha già letto i suoi dati all'avvio (le domande) non li rilegge
  una seconda volta.

## Nel codice

- `selectTab`, `sceltaApertura` e gli ascoltatori di `mg-scheda` in
  `src/pages/manage/manage.js`; `src/pages/manage/manageRedteam.js`.
- Prova: `tests/manage-sezioni.spec.mjs` («le schede spostate caricano anche
  aperte dalla sezione», «l'ultima sezione torna intera… con la sua scheda
  caricata»).
