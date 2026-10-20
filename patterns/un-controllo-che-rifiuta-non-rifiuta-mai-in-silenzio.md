# Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)

[← Tutti i pattern](../PATTERNS.md)

I controlli di plausibilità ("questo indirizzo esiste?", "questo file è troppo
grande?") esistono per risparmiare all'utente un vicolo cieco. Ma quando
scattano diventano loro il vicolo cieco, se l'unica cosa che succede è **niente**:
premere invio e non vedere accadere nulla è indistinguibile da un'app bloccata,
e l'utente non ha nemmeno modo di sapere che c'è un controllo (#433 — "/nas.lan"
restava rosso e muto).

- **Regola in due tempi:** (1) dillo — una riga di Filo che nomina la cosa
  rifiutata e il perché; (2) lascia insistere — un `.dash-action-btn` che fa
  comunque l'azione. Un controllo euristico si sbaglia (VPN, rete aziendale, DNS
  che non conosce quel nome): l'ultima parola è dell'utente, non dell'euristica.
- **Dopo l'"apri comunque", il controllo su quel bersaglio smette di parlare**
  (l'esito forzato entra in cache): ripetere l'avviso su una cosa già decisa è
  solo rumore.
- **L'input NON si svuota** quando il controllo rifiuta: se era un errore di
  battitura si corregge sul posto, senza riscrivere tutto.
- **Prima di aggiungere un controllo, guarda chi è già esente**: se localhost e
  gli IP privati sono esclusi, anche i nomi della rete di casa (`nas.lan`,
  `raspberrypi.local`) lo devono essere — la simmetria mancante È il bug.
- **Un blocco di sicurezza non si scavalca, ma si dice lo stesso** (#482): un file
  del computer, una cartella di rete, un `data:`/`javascript:` fermati hanno una
  notifica di solo testo (cosa e perché), mai «Apri comunque». La dice chi ferma
  (`fermaNavigazione` in `src/main/tabs.js`, testo in
  `src/main/services/indirizzoFermato.js`). Dove a rifiutare è Chromium prima di
  Filo (un `file:` o un `data:` che una pagina web apre da collegamento, script o
  finestra nuova) resta solo la sua riga in console: la legge il main
  (`_seguiRifiutiDiChromium` in `tabs.js`), solo dopo un input vero e una volta per
  gesto; quello che la pagina tenta da sola resta muto (#1318). Quella riga la
  pagina la può imitare, e lo stesso vale per l'indirizzo di un suo collegamento:
  l'avviso di un indirizzo scritto da una pagina web nomina il sito e il tipo, mai
  il percorso; un'immagine o un riquadro della pagina che Chromium rifiuta non è
  un'apertura e tace. Prova `tests/indirizzo-fermato-avvisa.spec.mjs`.
- **Quello che l'assistente chiede di aprire non diventa mai una ricerca**: un
  percorso è un file fermato e detto, la posta senza `mailto:` va al programma di
  posta, il resto torna al modello come «non è un indirizzo» (`indirizzoChiesto`).
- **Prima di rifiutare un indirizzo, leggilo come la barra** (#1318): un indirizzo
  scritto da un modello o da Filo (`localhost:3000`, un percorso fra virgolette) si
  giudica per quello che diventa caricandolo, con `indirizzoDaCaricare` di
  `src/shared/urlNav.js`, in ogni porta. Preso per uno schema ignoto, veniva
  fermato con un motivo falso, mentre dalla barra si apriva.
- **Dove:** `showUnresolvedSite()` in `src/pages/dashboard/dashboard-comandi.js`,
  esenzioni in `src/shared/urlNav.js` (`isLocalHost`/`isLocalNetworkName`) usate
  da `src/main/services/hostResolve.js`. Test
  `tests/dashboard-local-network-address.spec.mjs`,
  `tests/unit/urlNav.test.mjs`, `tests/unit/hostResolve.test.mjs`.
