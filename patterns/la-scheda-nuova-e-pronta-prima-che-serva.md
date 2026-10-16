# La scheda nuova è pronta prima che serva

[← Tutti i pattern](../PATTERNS.md)

Ctrl+T è l'azione più frequente di un browser, e creare la scheda al momento costava sempre un attimo di vuoto: un
processo nuovo, una quarantina di script, la home disegnata da zero (misurato in cloud: 400-850 ms fino alla home a
schermo, e il primo fotogramma era una home a metà). Decisione dell'owner (#1128): ogni finestra tiene SEMPRE una
home già caricata in una vista nascosta, senza condizioni su batteria o memoria. Con la riserva la stessa misura dà
40-100 ms, con la home intera al primo fotogramma.

- **Dove.** `src/main/tabs/riservaNuovaScheda.js`. `openTab` della home davanti la prende (`riserva.prendi`) al
  posto di una vista nuova e ne prepara subito un'altra; la prima nasce poco dopo l'avvio, dietro alle schede vere.
  Chi apre la home con qualcosa da fare al caricamento (zoom o scorrimento da rimettere, una finestra adottata) non
  la prende: quegli eventi la riserva li ha già avuti.
- **Non è una scheda.** Sta fuori da `tabs`: barra, sessione salvata, archivio, conti e anteprime non la vedono. È
  figlia della finestra, in fondo alle viste e nascosta (`setVisible(false)`), con la stessa cornice della scheda
  davanti (`_altezzaCornice`, compatta o intera): con un'altra misura alla consegna si ridisponeva e la casella
  saltava; alla consegna la si riaggiunge, così sale in cima come una vista nuova.
- **Non prende mai la tastiera da nascosta, e la riceve alla consegna.** Una vista che si carica già dentro la
  finestra si prende il fuoco, anche nascosta: i tasti dell'utente (Ctrl+T compreso) finivano nella home che nessuno
  vede. La riserva si carica fuori ed entra nella finestra a caricamento finito; se il fuoco le arriva lo stesso,
  torna alla scheda davanti. Consegnata, il fuoco glielo dà `openTab`, anche togliendolo alla barra: la home che si
  caricava se lo prendeva da sola, e senza quello le lettere scritte dopo Ctrl+T o il «+» restavano alla barra. Lo
  vedono solo tasti e clic veri (xdotool): un Ctrl+T simulato dentro la barra non lo mostra.
- **Parla già come la scheda che diventerà.** Ha l'id futuro, e `senderInfo` (ipc.js) la riconosce con la sua
  finestra e con `riserva: true`: senza, in incognito leggeva e scriveva il disco, e chi chiede «sei davanti?» le
  rispondeva sì. Quello che la pagina dice di sé mentre aspetta (colore, «all'Esc rispondo io», l'icona) lo tiene la
  riserva (`_perScheda`) e passa alla scheda. Gli eventi del caricamento non si ripetono: titolo, caricamento e
  cronologia la scheda li legge dalla vista alla consegna.
- **Riceve gli annunci delle schede.** Chi annuncia alle schede (impostazioni, tema, carte, scaricamenti, schermo
  intero, disposizione delle icone) passa da `vistePerAnnunci`, che comprende la riserva: così una carta tolta o un
  tema cambiato prima del Ctrl+T si vedono nella scheda nuova. Un giro su `.tabs` scritto a mano la lascerebbe
  indietro: lo ferma `tests/unit/riservaNuovaScheda.test.mjs`.
- **Che sia la riserva lo dice il main, non `document.hidden`.** In una vista di Filo la pagina resta «visible»
  anche nascosta (verificato: la riserva rispondeva `visible`). La home chiede `TAB_IN_VISTA_GET`, che per la
  riserva risponde `riserva: true`, e alla consegna riceve `TAB_IN_VISTA`; quello che va fatto solo davanti
  all'utente (recap dell'aggiornamento, ringraziamento e premio dei feedback, regalo, benvenuto dell'invito) aspetta
  la consegna. Le prese «una sola scheda» decise dal main (la ripresa dell'intervista) la riserva non le prende. Le
  home che sono schede vere restano come prima.
- **Arrivata davanti rilegge il minimo.** La riserva consegnata rilegge solo ciò che una home nuova chiede
  aprendosi e che nessun annuncio porta: il messaggio della home (senza passare dal vuoto, e chiedendo il ricalcolo se
  è vecchio), la richiesta lasciata dall'avviso del sito pericoloso, la ripresa dell'intervista.
- **Si rialza da sola.** Renderer morto o caricamento fallito: la riserva si butta e rinasce dopo qualche secondo.
  Una riserva che non c'è (consegnata un attimo fa, mai nata) fa ripiegare `openTab` sulla vista nuova di sempre.
- **Nelle prove è spenta.** Centinaia di spec cercano la home per indirizzo o contano le viste: `playwright.config.js`
  la spegne, e chi la prova la riaccende con `test.use({ riservaNuovaScheda: true })` (fixture) o con
  `FILO_RISERVA_NUOVA_SCHEDA=1`. Prova: `tests/riserva-nuova-scheda.spec.mjs`.
