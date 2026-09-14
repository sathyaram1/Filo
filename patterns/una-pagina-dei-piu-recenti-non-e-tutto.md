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

## Il segnale, quando lo incontri

Cerca il punto in cui il codice scrive `pageSize` e poi tratta il risultato come
se fosse l'insieme: un `find` su quella lista, un «quali mancano», un
«quali vanno tolte». Sono tutte domande sull'insieme, fatte a una finestra.
