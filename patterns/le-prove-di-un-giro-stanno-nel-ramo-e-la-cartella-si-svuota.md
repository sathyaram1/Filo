# Le prove di un giro stanno nel ramo e la cartella si svuota

[← Tutti i pattern](../PATTERNS.md)

Le prove scritte durante un giro di verifica restano nel ramo, in
`tests/verifica/<numero>/` (in locale, dove un numero non c'è, la cartella la dice il
compito che riceve chi verifica). Servono a una cosa sola: controllare, al giro dopo,
che le porte chiuse non si siano riaperte.

## Quante volte si corrono

**Una volta per giro.** Le rilancia chi verifica, in partenza. Chi corregge lancia solo
le prove dei rilievi che sta correggendo, e la chiusura non le rilancia affatto. Il
comando è `npx playwright test tests/verifica/<numero>`, con il percorso scritto
**relativo alla radice del repo e con le barre normali**: con le barre di Windows (la
forma che il completamento del terminale produce da solo) o per intero dalla radice del
disco, la risposta è «No tests found» anche a cartella piena, la stessa che dà una
cartella che non c'è. Prima di concludere che non c'era niente da rilanciare, si guarda
la cartella.

## La cartella si svuota invece di crescere

- La prova di un rilievo che esce dal giro in un feedback suo (esterno, o interno lasciato
  fuori) si CANCELLA: il testo del rilievo viaggia nel feedback, e una prova rossa lasciata
  indietro è un rosso da rispiegare a ogni giro.
- Si cancella anche quella di un rilievo corretto, nello stesso commit in cui si scrive la
  prova durevole che lo tiene chiuso. Se una prova durevole non c'è, la prova del giro
  resta.
- Restano le prove dei rilievi che hanno fermato il lavoro: le tratta chi riprende.
- Una prova che copre anche un caso ancora aperto non si cancella: le si toglie il caso
  che se ne va.
- La consegna della correzione (`verify-local.mjs corretto`, `dispatch.mjs --record-fixed`)
  rilancia una volta le prove cancellate, sul codice nuovo: una ancora rossa la respinge
  (#679, una prova rossa cancellata insieme alla correzione). Se il giro ha messo da parte
  dei rilievi le rosse si elencano soltanto, perché da lì non si sa quale prova sia di
  quale rilievo (`scripts/lib/prove-tolte.mjs`).

## Il rosso atteso

Nel commit di una correzione c'è anche il ripiego del rosso atteso
(`test.fail(true, '<motivo>')` in testa al corpo). **Dopo un verdetto invece si può solo
TOGLIERE**: una riga aggiunta lì fa decadere il verdetto e costa un giro intero, e i due
cancelli (la chiusura in locale, il cancello di fusione del server) lo controllano.

## Fuori dalla suite, davvero

La suite completa non le raccoglie (quelle di un solo feedback costano otto minuti e
mezzo); `FILO_TEST_VERIFICA=1` le include tutte. Ci vanno **davvero**, in una cartella
che porta il numero: una prova di giro lasciata nella radice di `tests/` entra nella
suite per sempre, e ogni spec riapre Filo (sessantadue erano già entrate così).

La sentinella è `tests/unit/proveDeiGiri.test.mjs`. Guarda il CONTENUTO, non il nome del
file (il nome è l'unica cosa che chi scrive può sbagliare): quello che sta nella suite
deve poter diventare rosso e non deve dichiararsi di passaggio, e l'elenco di cosa sta
nella suite lo chiede al raccoglitore invece di riscriverlo. Tiene anche il resto della
cartella: nessun byte NUL crudo nei sorgenti, ogni import relativo che risolve.
