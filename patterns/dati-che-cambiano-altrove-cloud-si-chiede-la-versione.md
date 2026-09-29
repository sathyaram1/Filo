# Dati che cambiano ALTROVE (cloud): si chiede la VERSIONE, non il dato

[← Tutti i pattern](../PATTERNS.md)

Il pattern
[«Vai a guardare in quell'altro posto»: quel posto deve accorgersene DA APERTO](vai-a-guardare-in-quellaltro-posto-quel-posto.md)
vale quando chi produce l'evento sta sulla stessa macchina e può suonare un
campanello. La dashboard di gestione legge i feedback da Firestore, dove
scrivono le routine in cloud e il server: nessun campanello
arriva fin qui, e senza SDK (che non usiamo) non c'è un canale in ascolto.
Quindi la pagina DEVE chiedere — ma chiedere costa, e ricaricare tutto
(5 MB, poi la decifratura) era il motivo per cui la pagina si apriva in dieci
secondi e nessuno la ricaricava.

- **A ogni giro si chiedono le sole versioni** (id + ultima scrittura del
  documento, la mette Firestore da sé: proiezione `__name__`, ~130 KB per 500
  feedback), si confrontano con quelle in mano, e **si rileggono solo i
  documenti cambiati o nuovi**, in una richiesta sola (`batchGet`). Un giro
  senza novità non ridisegna niente e non decifra niente.
- **Il ritmo è una spesa, e va detto dove si regola**: ogni giro paga una
  lettura per feedback in pagina anche quando torna "niente di nuovo".
  Sessanta secondi tiene il passo con le routine (lavorano per minuti) per
  pochi euro al mese; è UNA costante (`SN_FEEDBACK_LIVE.POLL_MS`), non un
  numero sparso.
- **Si gira solo da visibili, e «visibile» lo dice il main.** In una
  WebContentsView `document.hidden` resta falso anche con la scheda in secondo
  piano, la finestra ridotta a icona o nascosta, e `visibilitychange` non
  arriva mai: misurato, la Gestione lasciata aperta in una scheda di sfondo
  leggeva cinquecento documenti al minuto tutto il giorno. Il main sa quale
  scheda è attiva e se la finestra si vede: `TAB_IN_VISTA_GET` alla partenza,
  il broadcast `TAB_IN_VISTA` a ogni cambio. Al rientro si rilegge subito
  (se l'assenza supera `RIENTRO_MIN_MS`). Una finestra coperta da un'altra
  applicazione ma non ridotta a icona resta «in vista»: il sistema non lo dice.
- **L'orologio decide, non legge.** Batte ogni pochi secondi e chiede a
  `decidiGiro` se è ora; un giro senza risposta oltre `GIRO_BLOCCATO_MS` si
  abbandona (prima fermava per sempre tutti i successivi, in silenzio), e dopo
  tre giri mancati l'intestazione della lista dice «ferma».
- **Un arrivo si deve vedere.** Chi entra in una sezione a pagina aperta porta
  un segno (sulla scheda e sulla linguetta della sezione) finché non lo si
  apre: con l'ordine «per numero» una pratica vecchia che torna nei Ricevuti
  cade a metà lista. Le fusioni ferme stanno in cima con QUALSIASI ordine.
- **Il ridisegno non toglie niente dalle mani dell'owner**: lo scorrimento si
  ancora alla prima scheda visibile (non ai pixel: se ne esce una più su la
  vista salterebbe), la selezione resta, la lista aspetta mentre il puntatore
  ci si muove sopra, il menu aperto non si chiude; il pannello aperto si
  aggiorna solo se non ci sta scrivendo dentro (i dati sotto si fondono
  comunque, e si vedono al giro dopo o riaprendo la scheda).
- **Le letture accessorie vanno a colpo sicuro**: per riunire i voti di pochi
  feedback riletti si chiedono le loro sole schede pubbliche, non tutte.
- **La prima lettura parte per prima**: la lista è la cosa più lenta (secondi
  di rete), quindi si avvia all'apertura della pagina e le altre letture di
  avvio girano mentre viaggia — non in fila davanti. E la decifratura di
  centinaia di feedback importa la chiave privata **una volta** e lavora in
  parallelo (pool di thread di Node): da sei secondi a meno di due.
- **Dati finti = giro fermo.** Un hook di test che inietta la lista spegne
  l'aggiornamento continuo, altrimenti il primo giro la rimpiazzerebbe con
  Firestore a metà spec; chi vuole provare il giro sostituisce le sorgenti
  (e con `setData(…, { dalVivo: true })` tiene acceso l'orologio vero).
- **Dove:** `src/shared/feedbackLive.js` (confronto, fusione, decisione del
  giro, arrivi, ancora dello scorrimento: tutto puro), `listVersions`/`getMany`
  /`getManyPublic` in `src/shared/feedback.js`, `inVista`/`_annunciaVista` in
  `src/main/tabs.js`, la sezione "Aggiornamento continuo" di
  `src/pages/manage/manage.js`. Test: `tests/unit/feedbackLive.test.mjs`,
  `tests/unit/feedbackLiveGiro.test.mjs`, `tests/unit/feedbackListLight.test.mjs`,
  `tests/unit/feedbackCryptoKeyCache.test.mjs`, `tests/manage-live-update.spec.mjs`,
  `tests/manage-ricevuti-vivi.spec.mjs`.
- **Il limite che resta** è il costo del giro in vista: una lettura per
  feedback in pagina al minuto. Chiedere solo i cambiati dopo un istante
  vuole un campo che OGNI scrittura firmi (server compreso): l'`updateTime`
  che Firestore tiene da sé non si può filtrare in una query.
