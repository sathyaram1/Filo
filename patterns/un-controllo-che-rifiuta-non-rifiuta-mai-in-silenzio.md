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
  `src/main/services/indirizzoFermato.js`); dove a rifiutare è Chromium prima di
  Filo (un `file:` o un `data:` che una pagina web apre, da un collegamento o da
  script) lo si legge dove Chromium lo scrive, nella console della pagina
  (`_ascoltaRifiutiDiChromium`, #1318): un'immagine o uno sfondo con un `file:`
  dentro scrivono lo stesso messaggio e non si dicono. Da una pagina, solo dopo
  un input vero: quello che tenta da sola resta muto. Il modello che chiede un
  indirizzo fermato riceve lo stesso testo, e la posta va al programma di posta
  anche da lui. Prova `tests/indirizzo-fermato-avvisa.spec.mjs`.
- **Prima di fermare, leggi l'indirizzo come lo legge la barra** (#1318):
  `localhost:3000` preso per lo schema «localhost:» era fermato «per sicurezza»,
  e un percorso fra virgolette finiva in una ricerca su Google. Chi apre per
  conto di Filo o del modello passa da `indirizzoDaCaricare` in
  `src/shared/urlNav.js`; la pulizia dei percorsi (`percorsoPulito`) è la stessa
  per chi apre e per chi legge i documenti.
- **Dove:** `showUnresolvedSite()` in `src/pages/dashboard/dashboard-comandi.js`,
  esenzioni in `src/shared/urlNav.js` (`isLocalHost`/`isLocalNetworkName`) usate
  da `src/main/services/hostResolve.js`. Test
  `tests/dashboard-local-network-address.spec.mjs`,
  `tests/unit/urlNav.test.mjs`, `tests/unit/hostResolve.test.mjs`.
