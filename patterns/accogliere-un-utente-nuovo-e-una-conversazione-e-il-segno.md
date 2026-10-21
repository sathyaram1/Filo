# Accogliere un utente nuovo è una CONVERSAZIONE, e il segno "già accolto" si scrive alla fine

[← Tutti i pattern](../PATTERNS.md)

Un'accoglienza fatta di schermate a passi contraddice tutto Filo: qui si fa
parlando, dentro la chat che l'utente userà comunque. Il modello riceve
l'**elenco** di cosa Filo vuole scoprire e cosa vuole dire, con la regola "una
cosa per volta, applica subito, poi vai avanti"; l'utente vede una chat normale
(`src/shared/onboarding.js`, blocco `PROMPTS.filoChatOnboarding`).

- **Il primo messaggio è scritto a mano, dal secondo parla il modello.** Su
  quella riga l'utente giudica Filo: non la si affida a un LLM.
- **Il segno "già accolto" si scrive alla FINE.** Scriverlo all'apertura è il
  difetto originale (#524): chi chiudeva la finestra senza rispondere non
  rivedeva più il benvenuto. Il segno unico è `done` nello stato
  dell'accoglienza; la vecchia chiave sopravvive solo come migrazione, per non
  ributtare nell'intervista chi era già stato accolto.
- **Sopravvive alla chiusura a metà**: la conversazione si salva turno per turno
  (lato main, non lato pagina) e alla riapertura torna a schermo com'era. Se
  l'ultimo messaggio era dell'utente, il turno riparte da solo.
- **Chi decide che è finita lo dice con un'azione** (`ONBOARDING` nel registro
  dei livelli), ma il codice ha comunque le sue due uscite: elenco finito, o
  troppi scambi. Un'accoglienza che non finisce mai è peggio di una incompleta.
- **Una scelta che spetta solo all'utente si mostra, non si applica** (#1188):
  il livello di autonomia il modello non lo può cambiare, quindi `ONBOARDING`
  con `autonomia: true` mette i livelli sotto la sua domanda e l'utente sceglie
  con le regole di Preferenze (alzare vuole «conferma»). Finché la domanda è in
  sospeso il clic è anche la risposta. Mentre la scelta è a schermo la voce non
  si spunta e l'intervista non si chiude, se no la scelta sparirebbe con la chat.
  Il turno di Filo si salva col segno, e alla ripresa la scelta è ancora lì.
- **L'ultimo atto è il RISULTATO, non un "fatto"**: alla chiusura le lezioni
  raccolte vengono compattate **subito** in memoria (compattazione forzata, non
  la soglia normale) e Filo genera la prima home personale. L'ordine conta:
  lezioni → compattazione → home, altrimenti la home nasce su un profilo vuoto.
- **Niente modello, niente accoglienza**: senza accesso e senza chiave la chat
  non può rispondere. L'intervista aspetta e la home spiega come attivare Filo;
  parte da sola appena l'accesso arriva.
- **Si rifà, e rifarla non cancella quella di prima**:
  `Preferenze → Rifai l'intervista di benvenuto`. Tutto ciò che Filo può fare
  una volta sola diventa una trappola se non si può rifare. E la prima
  conversazione con Filo è la prima cosa che l'utente gli ha raccontato di sé:
  il rilancio la ARCHIVIA (`past`), e nella stessa sezione di Preferenze si
  rilegge. Sostituirla non costava niente in meno. **Ma si archivia solo ciò che
  è davvero una conversazione**: se l'utente non ha mai risposto, quello che
  c'era è il solo benvenuto. Archiviarlo lo stesso riempiva l'archivio di voci
  «0 tue risposte» e, siccome se ne conservano cinque, bastava aprire e chiudere
  sei volte il pulsante per buttare fuori la prima conversazione vera. Il filtro
  sta in `normalize`, non solo dove si archivia, così ripulisce anche gli
  archivi già sporcati.
- **Quello che si conserva si toglie** (#1297): ogni intervista conservata ha la
  sua × in Preferenze (quella ancora aperta no: si chiude dalla home), e la
  cancellazione di tutta la memoria passa anche di qui (`dimentica`). Le parole
  dell'intervista sono memoria quanto il profilo; resta solo il segno «già
  accolto».
- **Rifarla non tocca le altre schede** (#1297): la fine dell'intervista arriva
  a tutte, ma torna alla home solo la scheda che la mostrava; e l'intervista non
  si apre in una scheda che ha davanti una conversazione, nemmeno se lì l'utente
  non ha scritto (riaperta, o continuata da un'altra scheda). E un turno è
  dell'intervista solo se arriva dalla sua conversazione (la sua targa): quello
  che si scrive nelle altre chat mentre è aperta, «stop» compreso, resta loro.
  Una scheda rimasta su un'intervista rifatta un'altra volta si lega alla nuova
  targa; «Riprendiamola» cliccato in una scheda con una chat aperta riapre
  l'intervista in una scheda nuova.
  La regola che chiude tutte queste porte insieme: solo il primo benvenuto prende
  ogni home; rifatta o ripresa (`rifatta` nello stato) l'intervista sta solo nelle
  pagine che l'hanno chiesta (`?accoglienza` nell'indirizzo, messo da Preferenze,
  da «Riprendiamola» e dall'apertura). Le altre, ricaricate o aperte da un
  collegamento, restano il filo; se è rimasta a metà, la home lo ricorda con la
  stessa riga di sotto («La presentazione è rimasta a metà»).
- **Chiusa a metà, la home lo dice**: il congedo vive in chat e la chat sparisce
  appena la home è pronta — col modello giù, in un istante. Il segno «già
  accolto» però è definitivo, e chi non fa in tempo a leggerlo non ha modo di
  capire perché Filo ha smesso di presentarsi. Se l'accoglienza si chiude prima
  della fine, lo stato porta `notice: 'early'` e la home mostra una riga con
  «Riprendiamola» e «No, va bene così», finché l'utente non risponde. Chi arriva
  in fondo non vede niente: non c'è niente da spiegare.
- **«Riprendiamola» riprende, non ricomincia** (#1297): riapre la stessa
  intervista (stessa targa, stesse spunte). Il congedo scritto dall'app e la
  frase che l'ha chiesto escono, così l'ultima battuta torna la domanda in
  sospeso, senza chiamare il modello; se a chiudere era stato il modello, il clic
  diventa la risposta dell'utente e Filo prosegue. Il tetto degli scambi riparte
  dalla ripresa. Da capo la si rifà da Preferenze.
- **Nel benvenuto pulito niente riquadri** (#592.2, #1297): lo stile proposto e
  quello che Filo impara su chi è l'utente si applicano subito, con una riga corta
  col testo esatto e il suo Annulla (la lezione annullata finisce fra le nascoste
  del quaderno). Col testo di altri nella conversazione torna il riquadro. Delle
  schede aperte il modello vede solo il sito: un titolo lo scrive la pagina, e
  potrebbe dettare uno stile.
- **Una scheda non è l'unica**: l'accoglienza vive nella scheda nuova, e di
  schede nuove se ne aprono quante se ne vuole. Ogni scrittura dello stato viene
  annunciata (`FILO_ONBOARDING_UPDATED`) e le altre schede si riallineano; il
  turno rimasto a metà lo riprende **una sola** scheda (prenotazione in memoria
  nel main). Senza, la seconda scheda restava ferma a com'era e rilanciava lo
  stesso messaggio una seconda volta.
- **Test**: `tests/unit/onboarding.test.mjs` (elenco, spunte, ripresa, chiusura,
  parola di stop, rifiuti, archivio), `tests/onboarding.spec.mjs` (il giro
  reale, compresa la home finale), `tests/onboarding-uscita.spec.mjs` (le vie
  d'uscita e le strade che si rompono: provider giù, "Riprova", due schede),
  `tests/onboarding-ripresa.spec.mjs` (la riga sulla home dopo una chiusura a
  metà), `tests/accoglienza-rifatta.spec.mjs` (le altre schede, la ×,
  «Riprendiamola», la riga corta della lezione, i titoli delle schede), `tests/verifica/524/verify-524-g2.spec.mjs` (rifiutare una proposta, rilanci a
  vuoto, testo ostile, tre schede).
- **Le prove partono da un utente già accolto**: una home aperta in un profilo
  nuovo comincia l'intervista appena Filo ha un modello, anche a metà prova, e
  il messaggio scritto subito dopo finisce lì dentro, o no, secondo i tempi. La
  configurazione delle prove (`FILO_TEST_ACCOLTO`) fa partire già accolto ogni
  Filo che apre una prova su una cartella nuova, da qualunque lancio: fixture,
  rete finta, banchi dei giri. Seminarlo in un aiuto per volta lasciava fuori chi
  apriva Filo per un'altra strada. Una prova dell'accoglienza chiede il profilo
  nuovo con `test.use({ accoglienzaFatta: false })` (o `FILO_TEST_ACCOLTO: '0'`
  nel suo lancio). Con l'accoglienza fatta la home
  aperta prepara il suo saluto col modello: una spia che conta le chiamate
  salta quella della home (il prompt dice «preparare la dashboard»). Sentinella:
  `tests/unit/proveChatAccoglienza.test.mjs`; prova: `tests/fixture-profilo-accolto.spec.mjs`.
