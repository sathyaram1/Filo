# Il permesso lo dà solo il bottone che lo nomina

[← Tutti i pattern](../PATTERNS.md)

Filo blocca una cosa, mostra una notifica e ci mette sopra un bottone per
insistere. È il modo giusto di bloccare: chi ferma qualcosa lascia sempre una
via d'uscita. La trappola arriva dopo, quando i bottoni "apri lo stesso"
diventano due o tre e li si fa passare tutti dalla stessa funzione.

Il caso (#590, terzo giro di verifica). La lista dei siti bloccati aveva un solo
scavalco dichiarato: "Apri comunque" sulla notifica *Sito bloccato*. Quel
bottone passava per la stessa funzione che apre un popup fermato dal blocco
popup, perché all'inizio i due facevano la stessa identica cosa: aprire un
indirizzo saltando un controllo. Poi il permesso di "Apri comunque" è cresciuto:
non più "questa apertura" ma "questo sito, per tutta la sessione, su ogni
strada", perché senza memoria il primo rimbalzo del server ributtava l'utente
fuori. Cresciuto lì, è cresciuto per tutti i bottoni che passavano di là.

Risultato: la chip "Bloccato popup da sito.esempio — Apri" toglieva quel sito
dalla lista dei siti bloccati fino alla chiusura di Filo. Nessuno l'aveva
deciso. E il sito che fa comparire quella chip lo sceglie la pagina, non
l'utente: bastava convincerlo a cliccare un bottone che parla di popup per
smontare la lista che aveva scritto lui, e da lì in poi nemmeno le aperture
proposte dal modello incontravano più un controllo. Sulla stessa porta passava
anche il "Riapri" della scheda-ponte richiusa dopo uno scaricamento.

La regola:

- **Un permesso, un canale.** Ogni permesso ha il suo metodo, il suo messaggio
  IPC e la sua azione dichiarativa nel toast (`openAnywayUrl` per lo scavalco
  della lista, `openUrl` per un'apertura normale). Due bottoni che oggi fanno la
  stessa cosa non sono lo stesso bottone: sono due consensi diversi che per caso
  hanno lo stesso effetto, e appena uno dei due cresce si scopre la differenza.
- **Il testo del bottone è il contratto.** Quello che il permesso concede deve
  stare scritto dove l'utente clicca. "Apri" su una chip che parla di popup
  autorizza quella finestrella, punto. Se serve concedere di più, si chiede di
  più, con le parole giuste.
- **Chi sceglie la domanda conta quanto chi dà la risposta.** Su "Apri comunque"
  l'utente sta guardando il nome di un sito che Filo ha fermato e decide su
  quello. La chip dei popup compare perché una pagina ha chiamato `window.open`:
  l'argomento della domanda lo ha scelto il sito. Un sì vale quanto vale la
  domanda a cui risponde.
- **Un permesso che dura si deve poter vedere e togliere.** Vale l'invariante di
  sempre: se si può concedere, si deve poter revocare.

Dove guardare: `openBlockedPopup` e `apriSitoComunque` in `src/main/tabs.js`
(due metodi, due canali IPC in `src/main/ipc.js`), la traduzione delle azioni
dichiarative dei toast in `src/renderer/shell.js`, e la memoria dei sì in
`src/main/services/siteBlock.js` (`allowHost`, azzerata quando l'utente cambia
la lista). La guardia sta in `tests/siteBlock.spec.mjs`, ««Apri» sulla chip dei
popup NON toglie il sito dalla lista».
