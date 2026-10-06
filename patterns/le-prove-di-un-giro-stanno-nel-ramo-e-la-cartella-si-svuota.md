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
  rilancia una volta le prove cancellate o cambiate, com'erano, sul codice nuovo: una ancora
  rossa la respinge (#679, una prova rossa cancellata insieme alla correzione; togliere il
  solo caso rosso e tenere il file è la stessa porta). Dopo un riallineamento contano solo
  le prove che ha toccato il ramo: quelle che main ha cambiato nel frattempo sono di altri
  lavori e non si rilanciano. Le prove dei rilievi messi da parte escono PRIMA di ogni
  correzione, in un commit che toglie solo quelle registrato da chi ha scritto la critica
  (`verify-local.mjs pulizia`, `dispatch.mjs --record-pulizia`): il confronto parte da lì,
  e una prova tolta ancora rossa ferma la consegna sempre (`scripts/lib/prove-tolte.mjs`).
  Dopo un «pass» la pulizia non si registra: la sigilla il rilascio di chi ha verificato (il punto fermo
  porta il ruolo), e un riallineamento confronta da quel punto fermo se dalla critica ha solo tolto prove
  del giro (#880). Il sigillo di un altro ruolo non vale come pulizia: una prova rossa tolta da chi
  riallinea ferma ancora, anche se il suo rilascio l'ha sigillata.
  La pulizia riconosce le prove dal nome, che porta il numero del rilievo riprodotto
  (`giro<k>-r<n>-<cosa>.spec.mjs`, il posto del rilievo nella critica): contare quante ne
  escono non bastava, perché un rilievo messo da parte senza prova sua lasciava uscire la
  prova rossa di uno da correggere.
- **Un file di supporto della cartella** (un aiuto, una pagina, dei dati) non è una prova, ma
  le prove ne dipendono (#746): quale file carica una prova lo decide Playwright (un import
  senza estensione, una cartella col suo indice, un file nuovo che fa ombra), non il nome
  scritto. Quindi un file di supporto aggiunto, cambiato o tolto nella cartella rilancia, com'erano,
  TUTTE le prove di quella cartella: indebolire l'aiuto che controlla un caso rosso è la stessa
  porta che cancellare la prova. Gli aiuti comuni dei test fuori dal giro (fixture, helpers)
  rilanciano le prove che li nominano; la configurazione di Playwright, che le usa tutte, le
  rilancia tutte. Quelli si rimettono com'erano in una copia del ramo a parte, mai al loro posto,
  perché un rilancio interrotto non lasci un file vecchio da committare; uno aggiunto si toglie
  dalla copia. Nella pulizia un file di supporto non conta fra le prove tolte.
- **La pulizia non spegne un caso rosso.** Prima di registrarla si rilanciano, sul codice
  della critica, le prove a cui ha tolto un caso e quelle della cartella di un file di supporto
  a cui ha tolto righe: ogni caso rosso prima deve restare rosso dopo (il confronto è per titolo del
  caso, dal rapporto JSON di Playwright, e regge le righe tolte di un describe intorno), e la prova deve avere ancora un rosso. Togliere col
  caso del rilievo messo da parte anche la riga che controlla quello da correggere la fa
  respingere, e così togliere per intero il caso rosso di un rilievo da correggere: in una prova
  che copre più rilievi il titolo di ogni caso porta il numero del suo (`r2 …`), ed esce solo un
  caso rosso che porta quello di un messo da parte. Quelle stesse prove la consegna le rilancia
  com'erano dopo la pulizia.

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
