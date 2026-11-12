## Lavoro server: anche filo-security

Questo lavoro tocca il server, il repo privato `sathyaram1/filo-security`. Il tuo biglietto porta l'ambito
`server`: finché resta pulito, il server ti lascia parlare con quel repo, e con quello soltanto. Qui il codice del
server lo tocchi: il resto di «Se il lavoro si fa solo in locale» (deploy, segreti, credenziali dell'owner) vale ancora.

Il clone sta **fuori** dal checkout di Filo, in `<CLONE>`. L'hook di salvataggio pubblica tutto quello che sta
dentro Filo: un file del server copiato lì finisce sul repo pubblico. Non copiare mai niente del server dentro Filo.

### Git verso filo-security: solo `git-server`

Ogni comando di git che parla con GitHub (clone, ls-remote, fetch, push) passa da qui, e solo da qui. Prima chiede al
server il token del biglietto: è lì che si decide se puoi (biglietto pulito, ambito, registro del ramo). In locale il
token va a quella sola chiamata di git: non resta nel clone, non si stampa, e aiutanti e askpass della macchina per
quella chiamata non valgono. In cloud il token non si usa: git passa dal proxy della sessione, con le sue credenziali,
e il proxy serve solo i repository agganciati alla routine. Il resto (checkout, commit, merge, diff) è git normale nel
clone.

```bash
node "<CANALE>" git-server clone "<CLONE>"
node "<CANALE>" git-server ls-remote "<CLONE>"
node "<CANALE>" git-server fetch "<CLONE>" <ramo>
node "<CANALE>" git-server push "<CLONE>" <ramo>
```

Uscita 4: il server non ha dato il token, e il motivo è stampato (biglietto sporco o chiuso, feedback non fidato, ramo
del server scritto fuori registro, GitHub che non risponde). Uscita 1 dopo «git è uscito con»: l'errore di git sta
sopra, e la riga dopo dice chi l'ha respinto (in locale GitHub, il proxy o un rifiuto senza firma; in cloud se manca
l'aggancio di filo-security alla routine, che è un passo dell'owner). Nelle note va il testo esatto di git, con quella
riga. Se è
il controllo dei permessi della sessione a bloccare il comando, copia nelle note il suo messaggio esatto. Non aggirare nessuno di questi no: niente token scritti nell'URL, niente aiutanti di credenziali, niente altre
credenziali. La parte del server da qui non si fa, e per qualunque ruolo è un guasto da dichiarare, anche quando il no
è per regola (biglietto sporco o chiuso, feedback non fidato, ramo del server scritto fuori registro): nessuno lo
riprende sul PC dell'owner. Vale la sezione «Un guasto dell'ambiente si dichiara nel rilascio», col testo esatto di
git o del rifiuto e la riga su chi l'ha respinto nel messaggio del rilascio. Il gruppo è `guasto: filo-security`. Un no
per la fiducia del feedback o per un permesso non lo chiedi tu all'owner: il server lo porta nei Ricevuti. Chi verifica non passa il lavoro guardando solo l'app: rilascia col guasto senza
registrare la critica, e il lavoro torna a un'altra verifica quando esce dal fermo del guasto.

### Il ramo

Lo stesso nome del ramo di Filo su cui ti ha messo dispatch (`git rev-parse --abbrev-ref HEAD` nel checkout di Filo).

- Lavoro nuovo: `git -C "<CLONE>" checkout -b <ramo> origin/main`.
- Lavoro nuovo con `payload.ripartenza`: il ramo del server nasce lo stesso da `origin/main`, mai dalla punta del
  tentativo di prima. Il registro conta solo i commit dichiarati sotto il nome del tuo ramo: quelli del vecchio, e i
  riallineamenti che il cancello ci ha scritto, lo renderebbero non fidato, e il ramo del server non si riscrive. Il
  lavoro di prima lo porti come un commit tuo, per `ripartenza.ramo` e per ogni ramo di `ripartenza.altri` che ti
  serve (se il fetch risponde «couldn't find remote ref», quel tentativo non aveva una parte server):

```bash
node "<CANALE>" git-server fetch "<CLONE>" <ripartenza.ramo>
git -C "<CLONE>" merge --squash origin/<ripartenza.ramo>
git -C "<CLONE>" commit -m "<ripartenza.ramo> portato sul ramo nuovo"
```
- Verifica o correzione: `node "<CANALE>" git-server fetch "<CLONE>" <ramo>` e
  `git -C "<CLONE>" checkout -B <ramo> origin/<ramo>`. Se sul server il ramo non c'è (git: «couldn't find remote
  ref»), il lavoro sta tutto nell'app.
- Riallineamento, se sei chi rifà la base: le parti sono due, e ognuna ha la sua regola. Il ramo di Filo si
  riallinea col rebase del tuo ruolo, anche quando la critica parla solo del server: la consegna lo vuole sopra main.
  Il ramo del server, quando la critica lo nomina, si allinea con un merge, e il divieto di `git merge` del ruolo vale
  per il ramo di Filo, non per questo: `node "<CANALE>" git-server fetch "<CLONE>" main`, poi
  `git -C "<CLONE>" merge origin/main`, conflitti risolti tenendo main per ciò che altri ci hanno già portato, poi prove
  e spinta come sotto.
- Suite di GitHub del server rossa senza niente da cambiare nel server (provava il ramo di Filo com'era prima del
  rebase, o il rosso non si ripete nelle prove del server qui): la suite riparte solo con una spinta nuova, quindi
  `git -C "<CLONE>" commit --allow-empty -m "rilancio della suite"`, poi spinta e riga `ramo-server` come sotto. Un
  rosso che chiede di cambiare il server segue la regola del ruolo sui rossi: nel report, e lo giudica chi verifica.

### Prove, spinta, registro

- Le prove del server: `npm ci` la prima volta, poi `npm test` in `<CLONE>/functions`, con `FILO_PUBLIC_REPO` uguale
  al checkout di Filo. Se il lavoro tocca anche l'app, le prove dell'app come sempre.
- Le prove del giro che riguardano il server vanno in `functions/test/` del clone, sul ramo, col nome e i titoli dei
  casi delle prove del giro dell'app, preceduti da `verifica-<numero>-` e con `.test.js` in fondo: è così che il
  cancello le riconosce come prove del giro.
- Le prove del giro sul server si tolgono come quelle dell'app, e nello stesso momento: quelle che escono in ogni esito
  nel commit della critica, quelle che la risposta del server elenca (anche dopo un pass) appena la leggi. La
  suite di GitHub del server le corre tutte, e una rossa lasciata lì la tiene rossa per sempre. Nel clone un commit
  che toglie solo quelle (un file intero, o il caso di un rilievo da una prova che ne copre altri), poi spinta e riga
  `ramo-server` come sotto. Quelle della critica si spingono e si registrano prima di registrare la critica: il
  verdetto prende come punta verificata del server l'ultima registrata.
- Il conto delle prove, app e server insieme, sui commit dei due rami: `node scripts/conta-prove.mjs --server "<CLONE>"`.
- Spingi solo il tuo ramo: `node "<CANALE>" git-server push "<CLONE>" <ramo>`. La suite di GitHub del server prova il
  ramo di Filo con lo stesso nome com'è al momento della spinta del server (main di Filo se non c'è): per questo la
  spinta manda prima da sé il ramo dell'app su origin, compresi i file nati da shell, e se quello non arriva il ramo
  del server non parte. Subito dopo, a ogni spinta e prima di consegnare:

```bash
node "<CANALE>" ramo-server <ramo> "$(git -C "<CLONE>" rev-parse HEAD)"
```

  Il server legge la punta e la scrive nel registro dei rami. Senza questa riga il ramo del server non risulta fidato
  e il lavoro non arriva su main.
- Mai: `main` di filo-security (né push né merge), `server:fondi`, deploy (`firebase`, `server:pubblica`),
  `.github/workflows`. GitHub non rifiuta da sé le spinte che li toccano (#1140): è la regola dell'owner (G3) a
  fermarti. Quel passo è suo, e si chiede con una domanda.

### Dopo la verifica

Un lavoro server passato va al controllo di sicurezza, che legge anche il diff del server. Poi il cancello, solo con la
suite di GitHub verde sullo sha esatto della punta registrata (l'ultima spinta, con la sua riga `ramo-server`: quella
verificata, o una che da lì toglie soltanto prove del giro, file interi o casi, e niente aggiunge o cambia), porta
prima la parte dell'app su main di Filo, coi controlli di sempre, e poi il ramo del server su main di filo-security. La
pubblicazione la fa GitHub, e incorpora main di Filo che ha già la parte dell'app. Non chiedere la fusione del server da qui.
