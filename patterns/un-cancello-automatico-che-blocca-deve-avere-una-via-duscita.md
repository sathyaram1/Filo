# Un cancello automatico che blocca deve avere una via d'uscita, e la via d'uscita è una PERSONA

[← Tutti i pattern](../PATTERNS.md)

Un controllo deterministico che dice di no a un caso legittimo — e lo dice
spesso — non è una difesa stabile: è una difesa che prima o poi qualcuno
smonta, perché il lavoro deve pur passare. Il controllo di sicurezza sulle
fusioni (L5) blocca chi tocca guardie, automatismi, regole del database e
chiavi; il lavoro locale dell'owner ci cade dentro quasi sempre, perché in
locale si lavora proprio su quelle cose (§10 di `SPEC-RIDISEGNO-MAX.md`).

La forma giusta non è indebolire il controllo né aggiungere un permesso a chi
chiede, ma **far decidere l'owner su ciò che non viene da lui**:

- **Il blocco apre una RICHIESTA IN ATTESA, non un rifiuto secco.** Chi ha
  chiesto riceve "l'ho messa in attesa, ecco dove approvarla" — mai un "decidi
  tu cosa farne" che non nomina nessuna mossa possibile.
- **Il sì lo dà l'owner, in Gestione: è una REGOLA del server, non un muro.**
  Vale per il lavoro senza la prova di chi l'ha chiesto (routine, feedback
  d'utente). Una sessione locale ha i poteri dell'owner, approvazione
  compresa: per regola non approva, e i suoi script non lo fanno. Scriverlo
  come impossibilità tecnica fa progettare guardie contro un muro che non c'è.
- **Il lavoro locale provato non aspetta (#908).** L5 serve contro gli attacchi,
  e il lavoro che l'owner chiede in sessione non lo è: pratica dell'owner o di
  una sessione, con la prova del mittente (`senderProof: 'admin'`) e il segno
  `localOnly`, fusa con `npm run finish -- --feedback <N>`. Il server fa girare
  L5 solo per registrare, fonde, scrive i blocchi in una traccia («Fuse senza
  chiedere» in Automazioni) e chiude la pratica. Il solo prefisso `local:` non
  basta: senza prova si torna alla richiesta in attesa, col motivo.
- **Due invarianti non negoziabili, e una scadenza che non è una di loro.**
  Reggono l'eccezione: si applica solo a ciò che è stato ESAMINATO (si registra
  lo `sha`, e si fonde quello, non "il ramo"; se il ramo si muove la richiesta
  decade), e vale **una volta sola** (la presa è una transazione, così due
  click non passano entrambi). Nessuna delle due si indebolisce col tempo.
- **La scadenza è comodità, non difesa: tararla come tale.** Era di mezz'ora,
  contro l'"approvo a memoria" — ma a quello risponde già la scheda, che dice
  cosa è stato bloccato: chi approva non deve ricordare, deve **leggere**. Il
  costo invece era vero: rifare la richiesta costa un giro di controlli intero
  (~15 minuti), e sul campo la prima è scaduta prima che l'owner riuscisse a
  cliccare. Ora è di 24 ore. **Regola generale:** una scadenza corta si paga
  con quanto costa rifare la cosa scaduta — se il costo è alto e la sicurezza
  che aggiunge è zero, è solo un modo per far smontare la difesa.
- **Chi approva deve leggere COSA sta scavalcando, in parole sue.** Le frasi
  che traducono i controlli scattati vivono dove vive la tabella dei controlli
  (il server privato) e viaggiano col dato: ricopiarle nel client le farebbe
  divergere, e un controllo nuovo comparirebbe come voce muta. Un blocco senza
  frase si mostra comunque col suo nome grezzo — nascondere una voce
  dell'elenco fa approvare più di quel che si crede. Vale anche per **chi ha
  chiesto**: su una superficie che esiste per separare chi chiede da chi
  approva, tacerlo le toglie metà del senso (e un identificativo tecnico non si
  stampa — si dice cosa significa).
- **Un'eccezione lascia traccia** dove l'owner la può guardare (chi, cosa,
  quando, quali blocchi scavalcati), non solo nei log del server.
- **Dove:** decisione pura + I/O in `filo-security/functions/src/routine/
  mergeApprovals.js`; avviso condiviso in `src/shared/mergeApprovals.js` +
  `src/styles/mergeApprovals.css`; campanello in
  `src/main/services/mergeApprovalSignal.js`. Test:
  `functions/test/routine-merge-approvals.test.js`,
  `tests/unit/mergeApprovals.test.mjs`,
  `tests/unit/mergeApprovalSignal.test.mjs`, `tests/merge-approvals.spec.mjs`.
