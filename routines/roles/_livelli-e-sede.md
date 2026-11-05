## Il livello e la sede di ogni rilievo

Ogni rilievo porta DUE cose indipendenti: il **livello** (quanto è grave) e
la **sede** (a chi tocca: a questo lavoro o a un altro). Si scrivono insieme
fra quadre, prima la cifra e poi la lettera: `[3i]`, `[2e]`, `[1i?]`, `[0e]`.
La lettera è obbligatoria: un rilievo senza sede viene respinto con la
spiegazione, non prende un valore in silenzio.

### Il livello: quanti lo incontrano

Il metro è la frequenza — quanti utenti lo incontreranno — non «esiste un
caso in cui si rompe» (esiste sempre). Filo ha pochi utenti e deve arrivare a
molti: un giro di correzione speso su un caso raro è tolto a ciò che un utente
nuovo vede per primo. La ricerca resta larga; è il livello che va dato con
misura.

- **3** — sicurezza (dati cancellati o portati fuori, attacchi alle routine),
  perdite importanti di soldi (un ciclo che fa milioni di chiamate al server),
  Filo inutilizzabile. Solo se ci si arriva con una pagina, un documento o
  un'azione NORMALE, senza condizioni particolari.
- **2** — una funzione che non funziona nel caso normale (quello che la
  maggior parte degli utenti prova per primo) o più di una volta su cinque; un
  danno cosmetico enorme ed evidentissimo; una porta di sicurezza che richiede
  una condizione rara (un gesto insolito, una grafia particolare).
- **1** — una funzione che fallisce di rado (meno di una volta su cinque), non
  cosmetica; un danno cosmetico locale ma evidente.
- **0** — un danno cosmetico raro.

Linea guida: **il 20% dello sforzo che dà l'80% del risultato**; il resto si
rimanda a quando ci saranno i mezzi (utenti paganti, modelli migliori o più
economici). Dopo una cura le vie rimaste sono rare per definizione, e il
livello scende da solo. Vale anche per la sicurezza: una porta che
l'attaccante raggiunge solo con una condizione rara è un 2, non un 3. Un
rilievo di livello basso non si perde: alzargli il livello per salvarlo non
serve, e costa.

Accertati che ogni rilievo sia reale: se hai un dubbio, verificalo prima di
scriverlo. Se sei in dubbio sul livello, scegli il più basso.

### La sede: interno, vicino o esterno

**Interno** (`i`) se una delle due:

- il difetto sta nello **scenario scritto nella segnalazione**: i suoi esempi,
  i suoi passi, la cosa che chiede, coi casi ovvi di quella cosa (in «rendi
  allegabili i documenti», un docx che non si allega è interno; il livello lo
  decide il caso: un pdf che non si allega è 2, un formato sconosciuto è 0);
- oppure **l'ha creato questo ramo**: il lavoro o una delle sue correzioni.
  Prima di scrivere `i` per questo motivo lo controlli sul codice, non a
  intuito: `git diff origin/main...HEAD -- <file>` sul punto che hai davanti.

**Vicino** (`v`): il difetto NON è di questo lavoro (per il resto sarebbe
esterno), ma sta in un file che il ramo modifica già. Lo controlli sul codice:
il file è nell'elenco di `git diff --name-only origin/main...HEAD`. Se c'è, è
`v`; se non c'è, è `e`.

**Esterno** (`e`) tutto il resto: un difetto che c'era già su `main` fuori
dallo scenario, in un file che il ramo non tocca; un'altra porta della stessa
classe che la segnalazione non nominava; un difetto in qualcosa che il ramo ha
aggiunto oltre il chiesto (l'aggiunta resta, il suo difetto va in un feedback
suo: non si disfa il lavoro fatto).

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

La sede non cambia il livello che scrivi: un 3 esterno resta un 3, un 3 vicino
resta un 3. Il giro lo decidono i rilievi interni: un vicino entra nella
correzione solo se il giro parte comunque per loro, perché il suo file è già
aperto; altrimenti esce in un feedback derivato col livello che hai scritto.
Non fa partire un giro, non lo paga e non ferma questo lavoro. Ogni esterno
esce subito in un feedback suo, con la priorità del suo livello (un 2 nasce a
1: la 2 la mette solo il manutentore), e non ferma questo lavoro — nemmeno col
`?`: la domanda viaggia nel suo feedback.

**Il segno `?`** dopo la lettera (`[2i?]`, `[1v?]`, `[1e?]`) dice che il
rilievo chiede una decisione dell'owner, su un trade-off che non si misura
(prodotto, gusto, dati dell'utente, un costo senza il dato per stimarlo:
CLAUDE.md § Iniziativa), e porta la sua
domanda (più sotto). Non copre un trade-off di costo: deciso con la stima e le
opzioni esposte non è un rilievo, altrimenti è un rilievo senza `?` (criteri
di verifica, punto 8). Un difetto non chiede decisioni. Nel testo del rilievo
scrivi **l'opzione che consigli**: un `[2i?]` non ferma il lavoro, chi corregge
applica quella e la domanda esce in un feedback a parte. Ferma il lavoro un
`[3i?]`, e una scelta **difficile da disfare** (dati degli utenti, sicurezza,
formati salvati su disco), che marchi col `!` dopo il `?`: `[2i?!]`. Un 1 o uno
0 col `?` esce in un feedback derivato senza fermare niente.

| segnalazione e rilievo | livello e sede |
|---|---|
| «Filo legge le pagine web» (esempi: quanto costa, a che ora apre): il listino della pizzeria sparisce dalla lettura | 2i |
| stessa segnalazione: il freno sugli indirizzi non riconosce i dati scritti al contrario | 1e |
| «limita le azioni dopo una lettura» (memoria, schede, impostazioni, terminale, rete): il limite non tiene sulle schede | 2i |
| stessa segnalazione: un collegamento scritto in chat porta fuori i dati con un gesto normale | 3e |
| «il timer non suona»: chiesto a parole, Filo dice che la manopola del volume — aggiunta dalla correzione — non esiste | 1i |
| stessa segnalazione: la pagina Preferenze aperta in un'altra scheda cancella le modifiche fatte altrove (c'era già su `main`, per tutte le pagine) | 2e |
| stessa segnalazione: nella pagina del timer, che il ramo modifica, l'etichetta del secondo allarme è tagliata (c'era già su `main`) | 1v |
| si scrive nelle chiavi SSH con un solo OK, sul cammino della segnalazione | 3i |
| la finestra ridimensionata a menu aperto non fa rientrare il menu, fuori dallo scenario | 0e |
