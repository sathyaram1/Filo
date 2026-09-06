# Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)

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
- **Dove:** `showUnresolvedSite()` in `src/pages/dashboard/dashboard.js`,
  esenzioni in `src/shared/urlNav.js` (`isLocalHost`/`isLocalNetworkName`) usate
  da `src/main/services/hostResolve.js`. Test
  `tests/dashboard-local-network-address.spec.mjs`,
  `tests/unit/urlNav.test.mjs`, `tests/unit/hostResolve.test.mjs`.
