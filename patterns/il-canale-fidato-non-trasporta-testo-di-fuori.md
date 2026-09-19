# Il canale fidato non trasporta testo di fuori

[← Tutti i pattern](../PATTERNS.md)

Un prompt di Filo ha due voci, e il modello impara a distinguerle dalla forma:
quello che dice Filo («l'utente ha cliccato», «ho eseguito la ricerca») e
quello che dice il mondo (la pagina, il web, un altro utente). La prima è un
ordine, la seconda è un dato. Basta che un pezzo della seconda entri nella
forma della prima perché chiunque possa impartire ordini all'agente.

**Il canale di Filo si scrive con parole di Filo, e con nient'altro.** Non è
una questione di quanto è lungo il pezzo di testo esterno che ci si infila:
quattro parole prese da un `aria-label` sono già una frase. Quando una nota
deve nominare qualcosa che viene da fuori — l'etichetta di un pulsante, un
selettore, il titolo di una scheda, i risultati di una ricerca — la nota dice
che quella cosa è «qui sotto» e la cosa viaggia a parte, in una busta. È
l'inverso di quello che viene naturale scrivere, che è interpolarla nella
frase.

**Una sola funzione imbusta, e la conosce tutta la tabella dei tipi.** Con una
recinzione per fonte, scritta accanto a chi la usa, succedono tre cose: la
pulizia diverge, un contenuto può forgiare la recinzione di un ALTRO tipo, e la
fonte aggiunta domani non ce l'ha proprio. La porta unica in Filo è
`src/shared/contenutoEsterno.js` (`SN_ESTERNO`): tiene i tipi con la loro
intestazione, sa neutralizzare i nomi di tutte le marcature, taglia dichiarando
e compone il promemoria anti-inganno — che è l'elenco delle fonti esterne,
quindi si aggiorna da sé quando se ne aggiunge una.

**Due dettagli che sembrano cavilli e non lo sono.** Il primo: la pulizia di un
CAMPO e quella di un BLOCCO non sono la stessa. In un campo un a capo è già una
forgia, perché una riga è un dato; in un blocco gli a capo sono contenuto, e a
recintare è la marcatura. Il secondo: il nome di un tipo non deve essere una
parola di nessuna lingua. La pulizia cancella i nomi delle marcature ovunque li
trovi, e un tipo che si chiamasse `PAGINA` trasformerebbe quella regola in un
correttore automatico sul testo di chiunque — che poi va ritrovato identico
quando torna dal modello (il correttore semantico ci ripesca dentro le porzioni
segnate con `**…**`). Un trattino basso nel nome risolve tutti e due.

**Lo stesso testo composto in due punti diverge in silenzio.** Il turno
automatico dell'agente Aiuto serve due volte: il main lo mette nel messaggio
che parte, la sidebar lo mette nella propria cronologia, che tornerà al modello
in tutti i turni dopo. Se la busta la fa solo il main, un risultato avvelenato
è recintato per un turno e libero per il resto della sessione. Quindi la
composizione sta in un posto solo (`SN_CONST.PROMPTS.turnoAutomaticoAiuto`) e
dai due lati cambia al massimo la coda.

**La sentinella guarda il codice, non solo il comportamento.** Una prova sul
testo composto dice che oggi è a posto; non impedisce che domani qualcuno
rimetta insieme la stringa a mano da un'altra parte, che è esattamente com'era
nato il problema. In `tests/unit/contenutoEsterno.test.mjs` c'è un controllo
che cammina su `src/` e diventa rosso se qualche riga di codice, fuori da
`constants.js`, costruisce il canale di sistema per interpolazione.

Il caso (banco di prova di sicurezza, #593, gravità alta, raggiungibile senza
chiavi). L'agente Aiuto può chiedere una ricerca sul web. I risultati — titolo,
indirizzo e riassunto, tre campi che scrive chi possiede la pagina trovata —
venivano impastati in una stringa «risultati ricerca web per …» e mandati come
`userAction`, che il prompt rende come «(Sistema: …)» mentre le istruzioni
dicono al modello che le indicazioni di sistema arrivano proprio da quel
canale. Comparire fra i primi risultati per una query non è difficile, e il
ripiego di ricerca è pubblico: nessuna chiave da rubare. Guardando meglio, dalla
stessa porta passavano anche il titolo e l'indirizzo della scheda all'apertura
dell'Aiuto e l'etichetta dell'elemento appena cliccato.

Dove vive: `src/shared/contenutoEsterno.js` (la porta unica),
`src/shared/constants.js` (le buste dei singoli prompt e
`turnoAutomaticoAiuto`), `src/main/services/handlers.js` (il turno che parte),
`src/content/sidebar.js` (le note e la cronologia),
`src/shared/pathsSafety.js` (i percorsi condivisi, che dal #585 avevano una
recinzione propria e ora chiedono la stessa busta). Le sentinelle sono
`tests/unit/contenutoEsterno.test.mjs` e
`tests/aiuto-ricerca-web-imbustata.spec.mjs`, che guarda il flusso vero:
ricerca avvelenata, turno successivo, cronologia.

Il pattern che viene prima di questo, e che resta valido per il lato scrittura,
è [Contenuto di un utente nel prompt di un
altro](contenuto-di-un-utente-nel-prompt-di-un-altro.md).
