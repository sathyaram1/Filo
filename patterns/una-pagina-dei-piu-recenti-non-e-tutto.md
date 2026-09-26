# Una pagina dei più recenti non è «tutto»

[← Tutti i pattern](../PATTERNS.md)

Una lista che chiede «i primi N ordinati per data» risponde a una domanda sola:
**cosa è arrivato per ultimo**. Ogni altra domanda che le si appoggia riceve una
risposta sbagliata sulla coda, e la riceve in silenzio. Quindi: prima di
riusare una pagina già caricata, chiediti su quale ASSE è ordinata e se è quello
della domanda che stai facendo. Se non lo è, o cambi asse, o leggi tutto.

## Il caso: tre giri di verifica per lo stesso danno (#583)

La vista pubblica dei feedback (`feedback-public`, una scheda per fix chiuso) si
leggeva così: le 500 più recenti **per data d'invio**. Sembrava innocuo, perché
è lo stesso tetto e lo stesso ordinamento della lista vera. Poi le schede sono
diventate 552.

Da quel momento, quattro cose diverse hanno cominciato a sbagliare, e nessuna
lo diceva:

- **L'annuncio della ricompensa.** Una segnalazione vecchia chiusa oggi ha una
  data d'invio vecchia, quindi la sua scheda nasce già in fondo alla raccolta.
  Il popup ne chiedeva 200: chi aveva segnalato non riceveva né l'annuncio né i
  crediti, e intanto vedeva il proprio fix comparire in bacheca. Coi numeri
  veri: qualunque segnalazione rimasta in coda più di due mesi pagava zero.
- **La rimozione delle schede.** Per togliere una scheda bisogna prima vederla.
  Le 52 fuori pagina non le poteva togliere più nessuno, quindi un fix vecchio
  rimesso in lavorazione restava in bacheca come risolto, votabile e riapribile
  a pagamento: il doppione che il blocco delle riaperture doveva impedire.
- **La bacheca.** I fix più vecchi erano pubblicati e non comparivano.
- **L'auto-archiviazione.** Due volte. I voti stanno sulla scheda: senza scheda
  il punteggio era quello dei soli voti storici. E le segnalazioni su cui il
  giro decide si chiedevano anch'esse a finestra, le 500 più recenti per data
  d'invio: con 711 segnalazioni ne restavano fuori 211, cioè proprio quelle da
  archiviare per prime. I loro fix non uscivano mai dalla bacheca, restavano
  votabili e riapribili a pagamento, e per loro non si accendeva nemmeno il
  segnale «gli utenti dicono che non va».

La verifica ha trovato lo stesso danno in quattro giri di fila, da quattro
porte diverse. Ogni giro chiudeva la porta segnalata e lasciava le altre
aperte, perché nessuno aveva fatto l'inventario. Il quarto giro l'inventario
l'ha scritto qui sopra e ha chiuso tre porte su quattro: la quarta,
l'auto-archiviazione, l'aveva chiusa solo dal lato delle schede.

## La regola

**Chi vuole tutte le righe le legge tutte, paginando con un cursore.** Non
«alzo il tetto»: un tetto più alto è lo stesso difetto con una data di scadenza
più lontana, e quando scade non lo dice nessuno.

In `src/shared/feedback.js` le porte sono due, una per raccolta:
`listAllPublic()` per le schede della bacheca, `listAll()` per le segnalazioni
vere. Paginano passando dalla porta ESPOSTA — `listPublic` e `list`: una porta
sola, così chi la sostituisce in una prova sostituisce anche la lettura
completa — usano come cursore il **nome del documento**, unico e stabile mentre
una data può essere identica su due righe, e si fermano quando la pagina torna
più corta del limite.

Il freno sul numero di pagine c'è, ma **non mente**: se scatta, la risposta
porta `complete: false`. Un troncamento silenzioso qui vuol dire schede che
nessuno può più togliere e ricompense che non arrivano, e lo si scopre
settimane dopo (vedi CLAUDE.md § Limiti).

## Chi pagina col nome si prende anche l'ordine

Il cursore è il nome del documento, quindi una lettura completa arriva
nell'ordine degli identificativi: casuale. Finché la domanda era «i primi N per
data», l'ordine lo faceva il database e nessuno ci pensava. Dopo, l'ordine è
lavoro di chi legge, e chi si dimentica non vede niente di rotto: una lista
disordinata non lancia eccezioni.

È già costato due volte (#583, giro 7). Il comando che numera le segnalazioni
rimaste senza numero ha ricominciato a darli a caso, e l'annuncio della
ricompensa elencava i fix appena usciti in ordine di identificativo. Nessuna
prova diventava rossa.

Quindi, quando passi una lettura a paginare col nome: cerca chi consuma quella
lista e chiediti su quale asse la voleva. La bacheca se lo era già preso
(riordina lei per data d'invio) e infatti non si è rotta. Se l'ordine conta,
riordina **una copia** — quelle righe possono arrivare dalla memoria breve, ed è
la stessa lista che stanno leggendo altri.

Attenzione a come leggi la data per riordinare. Su un documento grezzo di
Firestore `createdAt` è un `timestampValue`; i documenti più vecchi ce l'hanno
come `stringValue`, qualcuno importato come `integerValue`. Un lettore che ne
guarda una sola torna vuoto sugli altri, e vuoto contro vuoto dà zero: il
confronto dice «pari» per tutte le righe e l'ordinamento non sposta niente.
Il comando dei numeri è caduto esattamente lì. Una data che non si riesce a
leggere deve valere «non lo so» e finire in fondo, non zero, che è il 1970 e
scavalca tutti.

## Una lettura completa su un cammino caldo vuole una memoria breve

Leggere tutto costa una lettura per riga. Va bene una volta; non va bene a ogni
gesto. L'annuncio della ricompensa gira a ogni caricamento della home, e la home
è la pagina di **ogni scheda nuova**: appena è passato a leggere tutte le schede,
chi aveva mandato una segnalazione si riscaricava la bacheca intera ogni volta
che apriva una scheda. Misurate: quattro aperture, 2208 schede in otto
richieste, per una risposta che cambia una volta ogni mai.

Quindi: prima di mettere una lettura completa dietro qualcosa, chiediti **quante
volte parte**. Se parte spesso, dalle una memoria breve — `listAllPublic` ne ha
una di trenta secondi — e due modi di scavalcarla: `fresh: true` per chi deve
vedere lo stato appena scritto, e `forgetAllPublic()` per chi ha appena scritto
o tolto una riga.

Due dettagli che rendono la memoria innocua nelle prove. Si ricorda **la porta
da cui è stata riempita**: chi sostituisce la sorgente mette una funzione nuova,
la memoria non combacia più e si rilegge, quindi una prova non si ritrova mai
davanti i dati della scena precedente. E si ricorda **solo una lettura
completa**: memorizzare un troncamento vuol dire ripeterlo per mezzo minuto.

## La memoria breve limita le ripetizioni, non il costo (#678)

Una memoria di trenta secondi toglie le riletture DENTRO una sessione. Non
toglie la lettura: resta una per apertura, per riga e **per utente**. Con 550
schede e cento tester sono oltre un milione di letture al giorno, per due
domande che di righe ne volevano poche.

Il passo dopo non è una memoria più lunga: è **cambiare domanda**.

- «Mi spetta una ricompensa?» non è una domanda sull'insieme: riguarda le
  poche segnalazioni di CHI CHIEDE, e i loro identificativi li sa la sua
  macchina. Da #678 li scrive man mano che le manda
  (`src/shared/feedbackMine.js`), e chiede quelle schede per nome
  (`getManyPublic`): zero letture quando non c'è niente da sapere. L'impronta
  sulla scheda non si può interrogare, ed è voluto — è diversa su ogni scheda
  apposta, perché nessuno possa raggruppare i fix per segnalatore (#583).
- «Cosa mostra la bacheca?» è una domanda sulla PRIMA SCHERMATA: una pagina
  ordinata dal server (`listPublicPage`, cursore su data più nome del
  documento), le altre allo scorrimento. Le righe già viste stanno su disco, e
  al server si chiede solo cosa è cambiato da allora (`listPublicChangedSince`,
  sul timbro `publishedAt`): una lettura per scheda cambiata, non per scheda
  esistente.

Il prezzo, dichiarato: una scheda TOLTA non compare in nessuna domanda su «cosa
è cambiato», quindi la copia su disco scade — sei ore — e dopo si riparte dalla
prima pagina. Un tetto sul tempo, non sul numero di righe.

E chi segnalava già PRIMA che il registro esistesse non ha i propri
identificativi da nessuna parte: per un mese continua a cercarsi le schede
leggendole tutte, una volta al giorno invece che a ogni apertura, poi smette. È
una finestra che si chiude da sola; le installazioni nuove non ci passano mai.

## Da una pagina la lettura completa la fa il main

Le porte complete paginano col cursore, e `list` il cursore lo RIFIUTA quando
la chiamata arriva da una pagina `filo://`: le credenziali stanno nel main, non
lì. Quindi una pagina che prova a leggere l'insieme non ottiene una finestra —
ottiene un'eccezione alla prima riga.

La scheda delle statistiche dei feedback (#496) fa proprio domande
sull'insieme: «quante segnalazioni sono arrivate», non «quali sono le ultime».
Per lei `listAllPaged` ha un secondo cammino: da una pagina passa dal main
(`feedback_fetch`, `op: 'listAll'`), che pagina col token dell'owner e torna
`{ rows, complete }`. Il `complete` viaggia fino in pagina e si vede: quando è
falso la scheda scrive che i numeri sono minimi, non totali.

Il particolare che rende il cammino nuovo diverso dagli altri: la lettura
completa **non** riunisce i campi delle schede pubbliche e **non** fa partire
la sincronizzazione della vista. Un conteggio non ha bisogno dei voti, e
appenderli costerebbe una seconda lettura di tutto a ogni apertura della
scheda.

## Quando invece la finestra va bene

Quando la domanda È «gli ultimi N»: la posta dei feedback, un elenco che si
scorre, una diagnostica. Lì il tetto è una scelta, non una dimenticanza, e va
detto a chi guarda: `listHitCap` più `countLabel` scrivono `(24+)` invece di
`(24)` quando il caricamento ha toccato il tetto, e l'hover spiega perché. Un
numero che afferma un totale che non conosce è peggio di nessun numero.

## Come si prova

La prova non aspetta che la raccolta cresca: la si costruisce già oltre il
tetto. `tests/unit/feedbackListAllPublic.test.mjs` mette 552 righe davanti a una
sorgente che si comporta come Firestore (ordinata, tagliata, ripartenza dal
cursore) e chiede che arrivino tutte e 552, una volta sola ciascuna. Il caso
visto da chi usa Filo sta in `tests/feedback-resolved-reward.spec.mjs`: una
segnalazione vecchia, una pagina intera di segnalazioni altrui più recenti
davanti, e l'annuncio che deve pagare lo stesso.

`tests/unit/feedbackLettureComplete.test.mjs` copre le altre due metà: le 711
segnalazioni della collezione vera, e la memoria breve — quattro letture di fila
devono costare una bacheca sola, `fresh` e `forgetAllPublic` devono
scavalcarla, una sorgente diversa non deve ritrovarsi i dati di quella prima, e
un troncamento non si ricorda.

L'ordine ha le sue due. `tests/unit/backfillOrdineArrivo.test.mjs` mette davanti
al comando dei numeri tre segnalazioni in cui l'ordine per identificativo è
l'opposto di quello per data, e le date scritte in tutte e tre le forme; una
data illeggibile deve finire in fondo, non in testa. In
`tests/feedback-resolved-reward.spec.mjs` la stessa scena vista da chi usa Filo:
due fix suoi che escono insieme, e l'annuncio che deve partire dal più recente.

## Il segnale, quando lo incontri

Cerca il punto in cui il codice scrive `pageSize` e poi tratta il risultato come
se fosse l'insieme: un `find` su quella lista, un «quali mancano», un
«quali vanno tolte». Sono tutte domande sull'insieme, fatte a una finestra.

L'altro segnale è una lettura che cambia ordinamento. Se una query smette di
ordinare per data, ogni consumatore che quell'ordine lo dava per scontato è
adesso sbagliato, e nessuno di loro se ne lamenta.
