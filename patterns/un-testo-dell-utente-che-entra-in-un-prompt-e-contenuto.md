# Un testo dell'utente che entra in un prompt è CONTENUTO, non prompt

[← Tutti i pattern](../PATTERNS.md)

Una preferenza a testo libero che finisce nel messaggio di sistema di un agente
è un pezzo di prompt scritto da fuori, e ci resta dopo il riavvio. Non basta
che «l'abbia scritta l'utente»: testo ostile arriva nel contesto del modello
per vie del tutto ordinarie (il titolo di una scheda, un risultato web, il
riassunto di un file), e da lì basta convincerlo a salvarlo come preferenza.
Un inganno che durava un turno diventa un'istruzione permanente, senza
conferma e senza traccia.

Il caso che l'ha fatto nascere è il **#592** (banco di prova di sicurezza del
27 agosto 2026, gravità alta): la preferenza `agentStyle` accettava testo
libero senza tetto e senza livello di rischio, e `injectAgentStyle` lo
ACCODAVA al messaggio di sistema come istruzione «richiesta dall'utente».
Nell'agente di pagina cadeva così **dopo** la riga che dice di ignorare le
istruzioni della pagina, cioè nel punto dove non c'è più niente che lo tenga a
bada.

Quattro cose, tutte insieme. Tre sono difese, la quarta è quella che rende le
altre utili.

- **Livello di rischio 2.** Se è il modello a proporla, l'azione si sospende e
  il popup mostra il **testo esatto** che sta per diventare permanente, non
  un'etichetta («Stile dell'agente aggiornato» non è un consenso). Il livello
  sta nel setter di `src/shared/preferences.js`, come per tutte le altre
  (vedi il pattern sul registro dei livelli).
- **Un tetto di lunghezza, con rifiuto spiegato.** Uno stile sono una o due
  frasi; un secondo prompt di sistema è lungo. `AGENT_STYLE_MAX` in
  `src/shared/constants.js` è a 600 caratteri, tre volte il preset più lungo.
  Chi sfora riceve il numero e riscrive lui: **mai un taglio muto**, che
  mangerebbe proprio la parte che contava.
- **Un recinto, e i marcatori tolti dal testo — finché non ne restano.** Il
  testo entra fra `AGENT_STYLE_OPEN` e `AGENT_STYLE_CLOSE`, preceduto da una
  riga che dice che è contenuto dell'utente e seguito da una che dice cosa può
  e cosa non può fare. `sanitizeAgentStyle` toglie i marcatori dal testo:
  senza, basta scriverli per uscire dal recinto e tornare a parlare come il
  sistema.
  **La ripulitura va RIPETUTA finché il testo non cambia più.** Una passata
  sola si aggira spezzando un marcatore con un altro marcatore: `FINE STILE` +
  marcatore intero + ` SCRITTO DALL'UTENTE>>>` non contiene il marcatore, ma
  appena si toglie quello di mezzo i due pezzi si ricongiungono e il marcatore
  c'è. Annidando la cosa quante sono le passate fra la chat e il prompt (che
  erano tre) arrivava intero nel prompt in 187 caratteri, il recinto si
  chiudeva sulla prima riga e tutto il resto finiva fuori. Trovato dalla
  verifica del #592, giro 1. Vale per QUALSIASI ripulitura che toglie
  occorrenze da una stringa: se la rimozione può ricreare ciò che cerca, una
  passata non basta. E chi costruisce il recinto ripulisce da sé
  (`agentStyleBlock`) invece di fidarsi di chi lo chiama: è l'ultimo punto in
  cui ci si può ancora accorgere che dentro c'è un marcatore.
- **La posizione.** Il recinto va **prima** della riga anti-inganno del
  prompt, non dopo. I prompt dichiarano dove con un segnaposto
  (`AGENT_STYLE_SLOT`), piazzato in fondo alla parte immutabile e sopra la
  sezione di sicurezza: così il grosso del prefisso resta uguale per tutti (la
  cache del #422 continua a valere) ma le regole restano l'ultima parola.
  `injectAgentStyle` toglie il segnaposto anche quando non c'è nessuno stile,
  altrimenti finisce nel prompt come testo misterioso.

E poi il contorno, che è quello che si dimentica:

- **Resta visibile e cancellabile.** Il testo si rilegge in Preferenze →
  Stile dell'agente, col conteggio dei caratteri sotto la casella, e si toglie
  svuotando la casella o dicendolo a Filo («togli lo stile»). Se si può
  mettere si deve poter togliere, da tutte e due le strade.
- **Le porte laterali si chiudono.** `UPDATE_SETTINGS` è aperto anche ai
  content script delle pagine web: da lì `agentStyle` è tolto dal messaggio,
  come le chiavi API. E il choke point delle scritture (`applySettingsUpdate`)
  ripulisce i marcatori e scarta un valore oltre il tetto invece di
  accorciarlo.

**Non sono solo le preferenze.** Le **lezioni** che Filo si appunta da sé
(`SALVA_LEZIONE`) hanno la stessa portata: valgono da subito in ogni
conversazione e sopravvivono al riavvio, e ci si arriva dalle stesse vie
ordinarie. Hanno il loro tetto (`LESSON_MAX`, con rifiuto spiegato che torna al
modello) e il loro recinto nel prompt (`lessonsBlock`, in `filoChatContext` e
`filoDashboard`). Il livello resta 1, e di proposito: una conferma qui
confermerebbe chiunque sia alla tastiera in quel momento, che è proprio chi la
lezione di protezione vuole tenere fuori.

**Ma allora la quarta cosa deve esserci davvero.** Se una lezione entra senza
chiedere niente, l'unica cosa che la tiene a bada è che l'utente possa
rileggerla e toglierla: la visibilità non è il contorno, è ciò che paga il
livello 1. Il giro 6 della verifica ha trovato che non c'era. In nessuna pagina
di Filo si vedeva quello che si era appuntato, e l'unica strada per togliere una
riga era `CANCELLA_MEMORIA`, cioè cancellare TUTTA la memoria digitando
«conferma», profilo di mesi compreso. La frase «l'utente la vede e può
cancellarla fra le memorie» stava scritta in due punti del codice, e in uno di
quei due è la descrizione dello strumento che il modello legge: Filo la
ripeteva all'utente. Adesso il posto c'è, accanto allo stile: Preferenze →
Memoria di Filo mostra le lezioni ancora da riordinare e i moduli
(PROFILO, PREFERENZE, i capitoli che Filo apre da sé), ogni riga col suo ×, e
ogni gruppo con un «Dimentica tutto». La pagina si rilegge da sé quando Filo
scrive (`FILO_LIVE_UPDATED`), se no mostrerebbe una memoria che non è più
quella. Cancellare una riga manda indietro l'indice della riga **e il testo che
la pagina stava mostrando**: se non combacia più non si cancella niente, perché
una pagina rimasta indietro non deve portarsi via la riga sbagliata.

Una nota su cosa NON si è fatto: togliere una singola lezione **a voce** non si
può, e non è una dimenticanza. Un'azione «dimentica questa regola» sarebbe la
strada gemella di `SALVA_LEZIONE`, ma la darebbe in mano al modello, e la prima
cosa che un inganno le farebbe fare è cancellare la lezione di protezione che
lo tiene fuori. È un compromesso vero: decide l'owner, non l'automatismo.

**Il testo libero non è solo nelle «preferenze».** Il giro 4 della verifica ne
ha trovato uno fuori dall'elenco dei setter: l'id del modello, il campo delle
Opzioni in cui scrivi con quale modello Filo deve rispondere, libero per scelta
perché deve accettare anche un modello che non è in elenco. Quel testo entra
parola per parola nella riga del prompt che dice al modello come si chiama, e ci
resta dopo il riavvio, come lo stile. Un id vero è corto e sta su una riga,
quindi lì bastano la ripulitura dai marcatori e un tetto; sopra il tetto la riga
non si accorcia, sparisce (`sanitizeModelName`). La domanda da farsi non è «è
una preferenza?» ma «questo testo lo scrive qualcuno e finisce in un prompt?».

**Regola operativa.** Prima di aggiungere una preferenza a testo libero,
chiediti se quel testo finisce in un prompt. Se sì, le quattro cose qui sopra
valgono tutte. La sentinella `tests/unit/preferences.test.mjs`
(«REGOLA #592») sonda ogni setter con una stringa improbabile: quelle che se
la tengono identica sono le preferenze a testo libero, e devono essere censite
una per una con la riga che dice dove va a finire quel testo. Una preferenza a
testo libero nuova e non censita fa diventare rossa la sentinella.

Codice: `src/shared/constants.js` (`AGENT_STYLE_MAX`, `togliMarcatori`,
`sanitizeAgentStyle`, `validateAgentStyle`, `agentStyleBlock`,
`injectAgentStyle`, `LESSON_MAX`, `validateLesson`, `lessonsBlock`,
`MODEL_NAME_MAX`, `sanitizeModelName`, e i
segnaposto dentro `PROMPTS.helpStatic` / `PROMPTS.filoChatStatic`),
`src/shared/preferences.js` (setter `stile_agente`),
`src/shared/actionLevels.js` (il rifiuto non apre popup),
`src/main/services/handlers.js` (`applySettingsUpdate`, dispatch di
`IMPOSTA_PREFERENZA`, `toolResultText`),
`src/main/services/handlers/storage.js` (`AMMESSE_DA_WEB`: da un'origine web
passa solo l'elenco di ciò che è lecito),
`src/pages/preferences/preferences.js` (conteggio e rifiuto, e la sezione
«Memoria di Filo»),
`src/shared/filoMemory.js` (`memoryLines`, `removeMemoryLine`, `forgetLesson`,
`forgetMemoryLine`, `forgetMemoryModule`),
`src/main/services/handlers/filo.js` (i messaggi che leggono e cancellano la
memoria, tutti chiusi alle pagine web).
Prove: `tests/unit/agentStyle.test.mjs`, `tests/unit/filoMemory.test.mjs`,
`tests/agent-style.spec.mjs`, `tests/memoria-di-filo.spec.mjs`.
