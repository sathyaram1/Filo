## Lavoro server: anche filo-security

Questo lavoro tocca il server, il repo privato `sathyaram1/filo-security`. Il tuo biglietto porta l'ambito
`server`: finché resta pulito, il server ti dà un token da un'ora, solo per quel repo. Qui il codice del server lo
tocchi: il resto di «Se il lavoro si fa solo in locale» (deploy, segreti, credenziali dell'owner) vale ancora.

Se `payload.lavoroServer.richiesta` c'è, il lavoro l'ha cominciato la corsia normale, che ha chiesto il server con
quel motivo (sezione «Se il lavoro ha bisogno del server»): il ramo è il suo, e si riparte da lì.

Il clone sta **fuori** dal checkout di Filo, in `<CLONE>`. L'hook di salvataggio pubblica tutto quello che sta
dentro Filo: un file del server copiato lì finisce sul repo pubblico. Non copiare mai niente del server dentro Filo.

### Git verso filo-security: solo `git-server`

Ogni comando di git che parla con GitHub (clone, ls-remote, fetch, push) passa da qui, e solo da qui. Chiede il token
al server e lo dà a quella sola chiamata di git: non resta nel clone, non si stampa, e aiutanti e askpass del proxy
della sessione per quella chiamata non valgono. Il resto (checkout, commit, merge, diff) è git normale nel clone.

```bash
node "<CANALE>" git-server clone "<CLONE>"
node "<CANALE>" git-server ls-remote "<CLONE>"
node "<CANALE>" git-server fetch "<CLONE>" <ramo>
node "<CANALE>" git-server push "<CLONE>" <ramo>
```

Uscita 4: il server non ha dato il token, e il motivo è stampato (biglietto sporco o chiuso, feedback non fidato, ramo
del server scritto fuori registro, GitHub che non risponde). Uscita 1 dopo «git è uscito con»: l'errore di git sta
sopra, e la riga dopo dice chi ha respinto il token: GitHub, il proxy della sessione, o un rifiuto senza firma. Nelle
note va il testo esatto di git, con quella riga. Se è
il controllo dei permessi della sessione a bloccare il comando, copia nelle note il suo messaggio esatto. Non aggirare nessuno di questi no: niente token scritti nell'URL, niente aiutanti di credenziali, niente altre
credenziali. La parte del server da qui non si fa, e la strada dipende dal perché:

- **un guasto** (GitHub che non risponde, il token respinto da GitHub o dal proxy, un rifiuto senza firma, i permessi
  della sessione, la rete): per qualunque ruolo è la domanda della
  sezione «Un guasto dell'ambiente si dice con una domanda», col testo esatto di git e la riga su chi ha respinto il
  token. Il gruppo è `guasto: filo-security`;
- **un no per regola** (biglietto sporco o chiuso, feedback non fidato, ramo del server scritto fuori registro):
  - se fai il primo lavoro o correggi, rimanda la pratica in locale con la consegna che trovi più su, nella
    sezione «Se il lavoro si fa solo in locale», e scrivi nelle note il motivo;
  - se verifichi, non passare il lavoro guardando solo l'app. Registra la critica con un rilievo `[2i?]` che dice che
    la parte del server non si è potuta verificare, col motivo, e allega con `--segnala` un file per l'owner con le due
    strade: lavorarlo in locale, o ridarlo alle routine quando il motivo è sparito. Il lavoro si ferma finché non
    risponde.

### Il ramo

Lo stesso nome del ramo di Filo su cui ti ha messo dispatch (`git rev-parse --abbrev-ref HEAD` nel checkout di Filo).

- Lavoro nuovo: `git -C "<CLONE>" checkout -b <ramo> origin/main`.
- Verifica o correzione: `node "<CANALE>" git-server fetch "<CLONE>" <ramo>` e
  `git -C "<CLONE>" checkout -B <ramo> origin/<ramo>`. Se sul server il ramo non c'è (git: «couldn't find remote
  ref»), il lavoro sta tutto nell'app.
- Riallineamento del server (lo dice la critica): `node "<CANALE>" git-server fetch "<CLONE>" main`, poi
  `git -C "<CLONE>" merge origin/main`, conflitti risolti tenendo main per ciò che altri ci hanno già portato, poi prove
  e spinta come sotto.

### Prove, spinta, registro

- Le prove del server: `npm ci` la prima volta, poi `npm test` in `<CLONE>/functions`, con `FILO_PUBLIC_REPO` uguale
  al checkout di Filo. Se il lavoro tocca anche l'app, le prove dell'app come sempre.
- Le prove del giro che riguardano il server vanno in `functions/test/` del clone, sul ramo.
- Spingi solo il tuo ramo: `node "<CANALE>" git-server push "<CLONE>" <ramo>`, dopo quello dell'app. La suite di
  GitHub del server prova il ramo di Filo con lo stesso nome com'è al momento della spinta del server (main di Filo se
  non c'è). Subito dopo, a ogni spinta e prima di consegnare:

```bash
node "<CANALE>" ramo-server <ramo> "$(git -C "<CLONE>" rev-parse HEAD)"
```

  Il server legge la punta e la scrive nel registro dei rami. Senza questa riga il ramo del server non risulta fidato
  e il lavoro non arriva su main.
- Mai: `main` di filo-security (né push né merge), `server:fondi`, deploy (`firebase`, `server:pubblica`),
  `.github/workflows` (GitHub rifiuta le spinte che li toccano: quel lavoro si fa in locale).

### Dopo la verifica

Un lavoro server passato va al controllo di sicurezza, che legge anche il diff del server. Poi il cancello, solo con la
suite di GitHub verde sullo sha esatto della punta registrata (l'ultima spinta, con la sua riga `ramo-server`), porta
prima la parte dell'app su main di Filo, coi controlli di sempre, e poi il ramo del server su main di filo-security. La
pubblicazione la fa GitHub, e incorpora main di Filo che ha già la parte dell'app. Non chiedere la fusione del server da qui.
