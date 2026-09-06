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
- **Chiusa a metà, la home lo dice**: il congedo vive in chat e la chat sparisce
  appena la home è pronta — col modello giù, in un istante. Il segno «già
  accolto» però è definitivo, e chi non fa in tempo a leggerlo non ha modo di
  capire perché Filo ha smesso di presentarsi. Se l'accoglienza si chiude prima
  della fine, lo stato porta `notice: 'early'` e la home mostra una riga con
  «Riprendiamola» e «No, va bene così», finché l'utente non risponde. Chi arriva
  in fondo non vede niente: non c'è niente da spiegare.
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
  metà), `tests/verify-524-g2.spec.mjs` (rifiutare una proposta, rilanci a
  vuoto, testo ostile, tre schede).
