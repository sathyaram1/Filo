## Il livello e la sede di ogni rilievo

Prende un livello solo un difetto che riguarda l'**obiettivo** del feedback, o
che **questo ramo ha introdotto**. Tutto il resto è esterno: non prende
livello e diventa un feedback nuovo, classificato dopo come ogni altro.

Si scrivono fra quadre: un interno con la cifra e poi la `i` (`[3i]`, `[2i]`,
`[1i?]`), un esterno con la sola `e` (`[e]`, `[e?]`). La sede è
obbligatoria: un rilievo senza sede, con un livello fuori scala o un esterno
col livello vengono respinti con la spiegazione, non prendono un valore in
silenzio.

### Il livello: la modifica misurata sul suo obiettivo

- **3**: la modifica non risolve il problema nella maggior parte dei casi, o
  introduce un problema più grave di quello che risolve.
- **2**: risolve in meno dell'80% dei casi, o introduce un problema nuovo meno
  grave dell'originale.
- **1**: un caso molto raro fa fallire l'obiettivo; oppure è possibile un
  miglioramento incerto, che scrivi con pro e contro; oppure la modifica
  introduce un problema raro, o molto meno grave dell'originale.

Correzioni alla scala:

- in un lavoro di **sicurezza**, una strada ancora aperta con un'azione
  normale vale 3; una che chiede una condizione rara (un gesto insolito, una
  grafia particolare) vale 1;
- una modifica che introduce un **buco di sicurezza**, una **perdita di dati**
  o **Filo inutilizzabile** con un'azione normale vale 3, anche se non è
  peggio del problema che risolve;
- una scelta **difficile da disfare** (dati degli utenti, formati salvati su
  disco) ferma il lavoro e va al manutentore: si scrive col `?!` (più sotto).

Linea guida: **il 20% dello sforzo che dà l'80% del risultato**. Dopo una cura
le vie rimaste sono rare per definizione, e il livello scende da solo.
Accertati che ogni rilievo sia reale: se hai un dubbio, verificalo prima di
scriverlo. Se sei in dubbio sul livello, scegli il più basso.

### La sede: interno o esterno

**Interno** (`i`) se una delle due:

- il difetto riguarda **l'obiettivo del feedback**: la cosa che chiede, coi
  suoi esempi e i casi ovvi di quella cosa (in «rendi allegabili i
  documenti», un docx che non si allega è interno; il livello lo decide quanti
  casi restano fuori);
- oppure **l'ha introdotto questo ramo**: il lavoro, una delle sue correzioni,
  o qualcosa che ha aggiunto oltre il chiesto. Prima di scrivere `i` per
  questo motivo lo controlli sul codice, non a intuito:
  `git diff origin/main...HEAD -- <file>` sul punto che hai davanti.

**Esterno** (`e`) tutto il resto, anche se sta in un file che il ramo
modifica: un difetto che c'era già su `main` fuori dall'obiettivo, un'altra
porta della stessa classe che il feedback non chiedeva di chiudere. Non prende
livello: esce in un feedback nuovo, che si classifica come ogni altro, e non
ferma questo lavoro, nemmeno col `?` (la domanda viaggia nel suo feedback).

«C'era già su `main`» si prova su `origin/main` appena scaricato
(`git fetch origin main`), non sulla base del ramo: main può averlo corretto
dopo che il ramo è partito, e allora non è un rilievo. Ci rientra un test di
logica rosso sul ramo che il controllo di fine lavoro trova verde sulla fusione
con main: il suo messaggio nomina la base del ramo e il main su cui riprovarlo.

Non lo è nemmeno il contrario: una riga di novità del ramo rimasta sotto una
versione che main ha pubblicato DOPO la partenza del ramo. Sul ramo la
sentinella è verde, sulla fusione è rossa, e la riga la sposta da sé il
riallineamento che precede la fusione: spostarla adesso non regge alla
pubblicazione seguente. La riconosce `node scripts/novita-in-cima.mjs`, dopo
`git fetch origin main` («uscita su main dopo la partenza del ramo»). Resta un
rilievo una riga scritta sotto una versione già uscita quando il ramo è
partito: lì è rossa la sentinella del ramo stesso.

**Il segno `?`** dopo la lettera (`[2i?]`, `[1i?]`, `[e?]`) dice che il
rilievo chiede una decisione dell'owner, su un trade-off che non si misura
(prodotto, gusto, dati dell'utente, un costo senza il dato per stimarlo:
CLAUDE.md § Iniziativa), e porta la sua domanda (più sotto). Non copre un
trade-off di costo: deciso con la stima e le opzioni esposte non è un rilievo,
altrimenti è un rilievo senza `?` (criteri di verifica, punto 8). Un difetto
non chiede decisioni. Nel testo del rilievo scrivi **l'opzione che consigli**:
un `[2i?]` non ferma il lavoro, chi corregge applica quella e la domanda esce
in un feedback a parte. Ferma il lavoro un `[3i?]`, che decide l'owner, e una
scelta **difficile da disfare** (dati degli utenti, formati salvati su disco),
che marchi col `!` dopo il `?` a qualunque livello (`[2i?!]`) e che va al
manutentore. Un `[1i?]` esce in un feedback derivato senza fermare niente.

| segnalazione e rilievo | livello e sede |
|---|---|
| «Filo legge le pagine web» (esempi: quanto costa, a che ora apre): su quasi tutti i siti degli esempi la lettura non trova niente | 3i |
| stessa segnalazione: i listini scritti in tabella, uno su quattro dei siti provati, spariscono dalla lettura | 2i |
| stessa segnalazione: una pagina col testo scritto al contrario non si legge | 1i |
| stessa segnalazione: il freno sugli indirizzi, che c'era già, non riconosce i dati scritti al contrario | e |
| «limita le azioni dopo una lettura», lavoro di sicurezza: il limite non tiene sulle schede, con un'azione normale | 3i |
| stessa segnalazione: il limite si aggira solo con un nome di scheda in una grafia particolare | 1i |
| «il timer non suona»: la correzione cancella gli allarmi salvati all'aggiornamento | 3i |
| stessa segnalazione: chiesto a parole, Filo dice che la manopola del volume, aggiunta dalla correzione, non esiste | 1i |
| stessa segnalazione: la correzione salva gli allarmi in una forma nuova che le versioni vecchie non rileggono; tenerla o tornare alla vecchia? | 2i?! |
| stessa segnalazione: nella pagina del timer, che il ramo modifica, l'etichetta del secondo allarme è tagliata (c'era già su `main`) | e |
| la finestra ridimensionata a menu aperto non fa rientrare il menu, fuori dall'obiettivo | e |
