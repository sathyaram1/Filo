# Contenuto di un utente nel prompt di un altro

[← Tutti i pattern](../PATTERNS.md)

Quasi tutti i dati che Filo raccoglie tornano a chi li ha scritti. Quando invece
un dato cambia proprietario, cioè uno lo scrive e un altro se lo ritrova nel
messaggio di sistema del suo agente, cambia il modello di rischio. Chi attacca
non colpisce sé stesso, colpisce chi passerà di lì. Le due misure che seguono
valgono insieme, e nessuna copre l'altra.

**In scrittura conta la strada, non il login.** Un vincolo di forma nelle regole
(lunghezze, campi, tipi) non prova niente su come quel dato è nato. La pulizia
vera in Filo sono spesso dei modelli che girano sulla macchina di chi naviga, e
nessuna regola Firestore può vedere se sono passati. Nemmeno chiedere
l'autenticazione risolve, perché iscriversi è gratis: vedi
[«Sei loggato» non è un permesso](sei-loggato-non-e-un-permesso.md). Quello che
funziona è togliere la scrittura diretta a tutti i client e farla passare da una
funzione del server, che riapplica la pulizia e tiene i limiti di frequenza per
identità. Il mittente può restare anonimo. A cambiare è la strada.

Perché la pulizia sia davvero la stessa dalle due parti, vive in `src/shared/`,
da dove il backend di sicurezza incorpora i moduli condivisi al deploy. Una
copia scritta a mano nel backend diverge in silenzio, e nessuno se ne accorge
finché non serve.

**In lettura è contenuto esterno, dichiarato e recintato.** Anche a scrittura
chiusa, un contributo mandato in buona fede può riportare il testo di una pagina
ostile. Quindi il blocco si apre con un'intestazione che dice chi l'ha scritto e
che sono dati, non ordini. Sta fra due marcature. E la funzione che lo compone
ripulisce di nuovo ogni campo: niente a capo, niente caratteri di controllo,
niente marcature scritte dal contenuto. Un intento che scrive la riga di
chiusura farebbe credere al modello che quello che segue non è più contenuto
esterno. Il contenuto non deve poter produrre nemmeno una riga della struttura.

**La cancellazione dei dati personali vale per ogni campo che esce, e riconosce
più di un numero.** Un dato che cambia proprietario porta con sé quello che
c'era scritto sulla pagina di chi l'ha raccolto. Nel #585 la cancellazione
copriva il campo più ovvio (gli elementi toccati) e conosceva due forme: gli
indirizzi email e le cifre attaccate. Fuori restavano il percorso della pagina
di partenza, che spesso contiene chi sei (`/clienti/IT60…/estratto`), la frase
riassuntiva, che la scrive un modello ma leggendo gli altri due, e tutto quello
che personale è senza essere una fila di cifre: IBAN, codice fiscale, telefoni e
carte scritti con gli spazi. Una cancellazione che copre un campo su tre è una
cancellazione che non c'è. Falla passare a ogni campo, e provala sul contrario:
un selettore normale, con i suoi `nth-child(2)`, deve uscirne intero.

**Uno non si prende il posto di tutti.** Quando più contributi condividono un
tetto di caratteri dentro il prompt, servono due cose che sembrano una sola: un
tetto per il singolo, e il fatto che chi non ci sta venga SALTATO invece di
chiudere la fila. Nel #585 mancavano tutte e due: un percorso poteva pesare tre
quarti del tetto, e ci si fermava al primo che non ci stava, buttando via anche
quelli dopo che ci stavano. Due contributi lunghi, e tutto quello che il dominio
aveva imparato spariva dal prompt. Se il singolo va accorciato, il taglio si
dichiara nel testo: un contributo che finisce a metà senza dirlo è una bugia
detta al modello.

E il promemoria in fondo al prompt va aggiornato. È l'elenco di cosa non è un
ordine, e un elenco che ne nomina tre su quattro insegna al modello che il
quarto è diverso. Se aggiungi una fonte al prompt, la aggiungi lì dentro nello
stesso commit.

Il caso (audit pre-alpha, #585). La raccolta `paths`, i percorsi di navigazione
che l'agente Aiuto cita come «già riusciti ad altri», accettava create anonime
con soli vincoli di forma. Il testo finiva grezzo nel prompt sotto «Altri utenti
hanno già completato con successo questi compiti», cioè nella presentazione più
fidata possibile per del contenuto che chiunque poteva scrivere con la chiave
pubblica del repo.

Dove vive: `firestore.rules` (`match /paths`), `src/shared/pathsSafety.js` (la
pulizia condivisa col server e l'incapsulamento in lettura), `src/shared/paths.js`
(l'invio alla callable `pathSubmit`), il blocco «Percorsi condivisi» in
`src/shared/constants.js`. Le sentinelle sono due:
`tests/unit/firestoreRulesPaths.test.mjs`, dove una collezione con scrittura
anonima o è dichiarata col suo perché o non passa, e
`tests/unit/percorsiCondivisi.test.mjs`, che controlla intestazione, marcature,
promemoria e il contenuto che non riesce a forgiare la recinzione.

Una cosa che questo pattern non fa da solo: le regole le pubblica una mano.
Finché non gira `firebase deploy --only firestore:rules`, in produzione la porta
è ancora quella di prima.
