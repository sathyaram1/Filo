# Una spesa passa da un cancello unico, con una sentinella che lo difende

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando una cosa costa — soldi, una finestra del sistema, una
chiave di qualcun altro — il controllo che la limita non si ripete a ogni
chiamante: si scrive un punto di passaggio obbligato, ci passano tutti, e un
test statico diventa rosso se qualcuno raggiunge la risorsa da un'altra parte.

**Il caso.** Il limite di spesa mensile di Filo viveva dentro i due cammini
principali della chat. Gli altri chiamanti dovevano ricordarsi di ripeterlo, e
quattro se l'erano dimenticato: il giudizio anti-phishing, il classificatore
del blocco geografico, il titolo di un feedback e la sintesi vocale chiamavano
il fornitore di modelli direttamente. Quelle chiamate non si fermavano mai e
non comparivano in nessun conto. Il banco di prova di sicurezza le ha trovate
da quattro porte diverse, in quattro momenti diversi: era un difetto solo.

**Perché la sentinella, e non solo il cancello.** Un cancello che si può
aggirare si aggira, e quasi sempre per distrazione: chi scrive una funzione
nuova copia il chiamante che ha sotto gli occhi. Finché il cancello è una
convenzione, ogni funzione nuova è un'altra occasione di dimenticarsene, e la
dimenticanza si scopre mesi dopo, da un controllo fatto a mano. La sentinella
sposta la scoperta a pochi millisecondi dopo la modifica, sulla macchina di chi
l'ha scritta.

**Come si fa una sentinella che regge.** Due parti, perché una sola lascia
sempre una strada aperta:

- **Statica** — cammina i sorgenti e cerca i nomi da cui si raggiunge davvero
  la risorsa, con un elenco corto di file ammessi (il cancello e il modulo che
  parla con l'esterno). Cerca i NOMI, non i chiamanti conosciuti: è l'unico
  modo di coprire anche quello che ancora non esiste. I commenti vanno tolti
  prima del confronto, altrimenti il cancello stesso non può spiegarsi.
- **Di comportamento** — per ogni via d'ingresso del cancello, col limite
  esaurito, il fornitore finto non deve essere stato toccato. Elencare le vie
  in una tabella e generare un test per ciascuna fa sì che una via nuova senza
  il suo controllo si veda subito.

**La prova che vale.** Prima di dichiararla finita, la sentinella statica si fa
girare sul codice com'era PRIMA: se non diventa rossa lì, sta guardando la cosa
sbagliata. Non basta: va provata anche al contrario, scrivendo APPOSTA la
chiamata che deve far scattare — una per ogni nome dell'elenco. Alla prima
stesura ne mancava proprio quello principale, il nome con cui la risorsa si
trova su `globalThis`, che è poi il modo in cui il modulo di smistamento la
trova al suo interno: chi copiava quella riga passava, e la sentinella restava
verde.

**I nomi da cercare sono quelli dell'ULTIMO anello, non del primo.** Se lo
smistatore trova il fornitore per nome, quel nome è la porta vera: cercare
solo le funzioni dello smistatore lascia scoperto chi lo scavalca — e chi lo
scavalca è la persona distratta, non l'avversario.

**Anche quello che non costa passa dal cancello.** «Quanto resta su questa
chiave» non consuma niente e non ha un tetto da rispettare: sembra la
tentazione giusta per un'eccezione, ed è l'eccezione che apre il buco. Non
perché quella riga faccia danno, ma perché resta scritta nel progetto e viene
copiata per la chiamata successiva, che invece costa.

**Il modo in cui la sentinella legge i sorgenti deve sbagliare verso il
rosso.** Togliere i commenti con un'espressione regolare per riga tagliava alla
prima coppia di barre, e una stringa innocua (`"a//b"`) faceva sparire la
chiamata scritta dopo, sulla stessa riga: nessun rumore, nessun rosso, difesa
spenta. Ci vuole uno scorrimento carattere per carattere che sappia dove si
trova — codice, stringa, template, espressione regolare, commento — e che dal
codice non tolga mai niente. Un falso rosso si vede e si sistema riscrivendo un
commento; un falso verde non si vede mai.

**Dove vive.** `src/main/services/modelGate.js` (il cancello: limite di spesa,
conteggio dei costi, registrazione di chi ha servito),
`tests/unit/modelGate.test.mjs` (le due sentinelle). Il gemello fisico è
`src/main/services/safebrowse/sandbox.js`: lì la risorsa non è il denaro ma la
finestra nascosta, e il cancello è un tetto di concorrenza con la sua coda e un
tempo massimo di vita.

**Il tempo massimo va reso non annullabile.** Nel caso delle finestre nascoste
il timer di attesa c'era già, ma un evento lo annullava (la pagina aveva finito
di caricare) e da lì in poi niente chiudeva più la finestra. Un tetto di vita
si scrive come un secondo timer che solo la chiusura vera può spegnere.

**Il tetto vale anche per quello che la risorsa si porta dietro.** Una finestra
nascosta ha bisogno di una memoria di navigazione isolata. Fabbricarne una
nuova a ogni controllo, con un nome che non si ripete mai, sopravvive alla
finestra: la finestra muore col suo tetto di vita, la memoria resta registrata
finché il programma è aperto, una per ogni sito controllato. Il tetto di
concorrenza rende la chiusura gratis — se insieme ne girano al massimo due,
bastano due nomi riusati a turno, svuotati prima e dopo ogni giro. Svuotare
PRIMA e non solo dopo: l'isolamento non deve dipendere da quando è arrivato lo
svuotamento del turno precedente.

**L'indirizzo della risorsa su internet è una porta come le altre.** Cercare i
nomi interni copre chi resta dentro il progetto; chi scrive a mano la richiesta
di rete all'indirizzo del fornitore arriva allo stesso modello, paga sulla
stessa chiave e passa in mezzo alla sentinella senza toccarla. Gli indirizzi
non si scrivono nella sentinella: si leggono dal modulo che parla con
l'esterno, così un fornitore nuovo è coperto dal giorno in cui entra. E un
controllo che l'elenco degli indirizzi non sia vuoto, altrimenti il giorno in
cui la lettura smette di trovarli la porta si spegne in silenzio.

**Il freno è del dominio, il verdetto è dell'indirizzo.** Ricordare un verdetto
per host completo non frena nulla: chi controlla un dominio fa comparire
sottodomini nuovi a volontà. La tentazione è spostare il ricordo sul dominio
registrabile, e lì si sbaglia: su una piattaforma dove ogni utente riceve un
suo sotto-indirizzo (le pagine gratuite di Cloudflare, quelle di progetto di
GitHub, i blog ospitati) il dominio registrabile è la PIATTAFORMA. Il verdetto
di un sito di truffa sbarrava allora tutti i siti innocenti ospitati lì, e al
contrario il «pulito» di un sito innocente impediva del tutto il controllo del
sito di truffa vicino. Le due cose sono separate e vanno tenute separate: il
VERDETTO resta dell'indirizzo che l'ha prodotto, e a fermare la spruzzata basta
un CONTO sul dominio registrabile — quante verifiche costose quel dominio può
far partire nella finestra di tempo. Accanto serve l'elenco delle chiamate già
in volo: la memoria si riempie quando la risposta arriva, e cinquanta richieste
partite insieme la trovano tutte vuota.

**Una verifica costosa non si spende dove non può dare risultato.** Il
controllo profondo dei siti pericolosi partiva anche sugli indirizzi della rete
di casa: il router, il NAS, una stampante, un server di prova. Da fuori non li
raggiunge nessuno, quindi non possono essere la truffa che arriva da una mail,
e ognuno costava un giudizio del modello più una finestra nascosta puntata
sulla rete privata di chi naviga. Il nome `localhost` era già escluso; un
indirizzo numerico privato o un nome in `.local` no.

**Il conto è di chi possiede il sito, non di chi possiede il dominio.** Il
paragrafo qui sopra si fermava a metà strada. Tolto il verdetto dal dominio
registrabile restava il conto, e su una piattaforma di siti ospitati quel conto
è di tutti insieme: quattro sotto-indirizzi presi da chi attacca (gratuiti e
illimitati) lo esaurivano, e da lì in poi nessun altro sito di quella
piattaforma riceveva la verifica profonda, truffa vera compresa. La porta era
la stessa del giro prima, allargata da un vicino a quattro. Un tetto condiviso
fra estranei è un'arma in mano a chi lo esaurisce per primo: la chiave del
conto dev'essere la parte che il controllo protegge. In Filo la dà
`proprietario()` (`src/main/services/safebrowse/psl.js`): il dominio
registrabile, o il sotto-indirizzo quando il dominio registrabile è una
piattaforma multi-utente.

Quell'elenco di piattaforme invecchia, e dare a ogni sotto-indirizzo il suo
conto rimetterebbe in piedi la spruzzata sulle piattaforme che non conosce
ancora. Quindi accanto al conto per proprietario ne va tenuto uno COMPLESSIVO,
largo: quante verifiche costose in tutto nella stessa finestra di tempo.
Entrambi i conti vogliono una finestra FISSA, che parte al primo gettone e
scade da sola. Una cache con TTL non va bene: rimanda la scadenza a ogni
scrittura, e chi tiene caldo il contatore tiene spento il controllo per sempre.

**Lo stesso freno vale per ogni chiamata che parte da sola.** Il giudizio sui
siti pericolosi aveva i suoi freni; il riconoscimento del blocco geografico,
che parte allo stesso modo a ogni caricamento di pagina e sulla stessa chiave,
non ne aveva nessuno: duecento percorsi diversi sullo stesso sito facevano
duecento chiamate, e l'unico fondo era il tetto di spesa mensile, che esaurito
spegne tutta l'AI di Filo per il resto del mese. Se una chiamata parte senza
che l'utente la chieda, chi visita la pagina decide quante ne partono: il conto
per proprietario più il tetto complessivo vanno messi lì come altrove. E se la
stessa cosa viene campionata due volte (una a fine caricamento, una qualche
secondo dopo), serve l'elenco delle chiamate in volo: il ricordo si scrive
quando la risposta arriva, e un modello ci mette più di due secondi.
