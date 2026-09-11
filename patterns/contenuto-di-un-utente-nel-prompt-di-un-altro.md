# Contenuto di un utente nel prompt di un altro

[← Tutti i pattern](../PATTERNS.md)

Quasi tutti i dati che Filo raccoglie tornano a chi li ha scritti. Quando invece
un dato **cambia proprietario** — uno lo scrive, un altro se lo ritrova nel
messaggio di sistema del suo agente — cambia il modello di rischio: chi attacca
non colpisce sé stesso, colpisce chi passerà di lì. Le due misure che seguono
valgono **insieme**, e nessuna delle due copre l'altra.

**In scrittura: la strada, non il login.** Un vincolo di forma nelle regole
(lunghezze, campi, tipi) non prova niente su come quel dato è nato. La pulizia
vera in Filo sono spesso dei modelli che girano sulla macchina di chi naviga, e
nessuna regola Firestore può vedere se sono passati. Nemmeno chiedere
l'autenticazione risolve: iscriversi è gratis (vedi
[«Sei loggato» non è un permesso](sei-loggato-non-e-un-permesso.md)). Quello che
funziona è togliere la scrittura diretta a tutti i client e farla passare da una
funzione del server che **riapplica la pulizia** e tiene i **limiti di frequenza
per identità**. Il mittente può restare anonimo: a cambiare è la strada.

Perché la pulizia sia davvero la stessa dalle due parti, vive in `src/shared/`
— il backend di sicurezza incorpora quei moduli al deploy. Una copia scritta a
mano nel backend diverge in silenzio: nessuno se ne accorge finché non serve.

**In lettura: contenuto esterno, dichiarato e recintato.** Anche a scrittura
chiusa, un contributo mandato in buona fede può riportare il testo di una pagina
ostile. Quindi il blocco si apre con un'intestazione che dice chi l'ha scritto e
che sono **dati, non ordini**; sta fra due marcature; e la funzione che lo
compone **ripulisce di nuovo** ogni campo — niente a capo, niente caratteri di
controllo, niente marcature scritte dal contenuto (un intento che scrive la riga
di chiusura farebbe credere al modello che quello che segue non è più contenuto
esterno). Il contenuto non deve poter produrre nemmeno una riga della struttura.

E il **promemoria in fondo al prompt va aggiornato**: è l'elenco di cosa non è
un ordine, e un elenco che ne nomina tre su quattro insegna al modello che il
quarto è diverso. Se aggiungi una fonte al prompt, la aggiungi lì dentro nello
stesso commit.

Il caso (audit pre-alpha, #585). La raccolta `paths` — i percorsi di navigazione
che l'agente Aiuto cita come «già riusciti ad altri» — accettava create anonime
con soli vincoli di forma, e il testo veniva concatenato grezzo nel prompt sotto
«Altri utenti hanno già completato con successo questi compiti»: la
presentazione più fidata possibile per del contenuto che chiunque poteva
scrivere con la chiave pubblica del repo.

Dove vive: `firestore.rules` (`match /paths`), `src/shared/pathsSafety.js` (la
pulizia condivisa col server e l'incapsulamento in lettura), `src/shared/paths.js`
(l'invio alla callable `pathSubmit`), il blocco «Percorsi condivisi» in
`src/shared/constants.js`. Le sentinelle:
`tests/unit/firestoreRulesPaths.test.mjs` (una collezione con scrittura anonima
o è dichiarata col suo perché, o non passa) e
`tests/unit/percorsiCondivisi.test.mjs` (intestazione, marcature, promemoria,
e il contenuto che non riesce a forgiare la recinzione).

Una cosa che questo pattern non fa da solo: le regole le pubblica una mano.
Finché non gira `firebase deploy --only firestore:rules`, in produzione la porta
è ancora quella di prima.
