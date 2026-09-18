# Un protocollo di sistema ti consegna tutto: filtra l'host, e distingui il silenzio dal rifiuto

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Quando l'app si registra come gestore di uno schema (`filo://`),
il sistema le consegna **qualunque** indirizzo di quello schema, da qualunque
posto: un link su una pagina web, un'anteprima in una chat, un messaggio. Il
gestore accetta il solo host che quel collegamento serve e lascia cadere tutto
il resto, senza aprire niente. Ma «non è roba mia» e «è roba mia, scritta male»
non sono la stessa cosa: il primo è silenzio, il secondo si dice.

**Il caso.** Il link d'invito (#651) ha portato dentro Filo il collegamento
`filo://invito/<codice>`: chi riceve un invito clicca, Filo si apre e riscatta.
Per riceverlo, Filo si dichiara al sistema come gestore di `filo://`
(`app.setAsDefaultProtocolClient`, più `protocols` nella ricetta del pacchetto,
che su Mac diventa l'`Info.plist`).

Da quel momento `filo://` non è più solo l'indirizzo interno delle pagine di
Filo: è una porta aperta sul mondo. Un sito qualsiasi può mettere in una pagina
`<a href="filo://credits/credits.html">`, e il sistema consegna quell'indirizzo
a Filo esattamente come consegnerebbe un invito. Un gestore che si limita a
«apri quello che ti arriva» lascia decidere a chi ha scritto la pagina quale
superficie interna aprire, e quando.

Quindi il gestore guarda **l'host** prima di tutto:
`SN_WALLET.isInviteDeepLink(url)` è vero solo per l'host `invito`, e tutto il
resto non apre schede e non fa niente.

**Il secondo passo, quello che si dimentica.** Il primo filtro, da solo, fa
sparire anche gli errori di chi il link l'ha cliccato davvero:
`filo://invito/ABCD` (codice tagliato da una chat, o storpiato da un
copia-incolla) è un invito, ma il codice non è un codice. Trattarlo come «non è
roba mia» vuol dire che l'utente clicca e non succede niente — indistinguibile
da un'app rotta (vicino: [Un controllo che RIFIUTA non rifiuta mai in
silenzio](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md)). Per questo
la domanda «è un invito?» sta separata da «qual è il codice?»: la prima decide
se si apre bocca, la seconda cosa si dice.

**Da dove arriva l'indirizzo.** Non da un posto solo, e il ramo mancante non si
vede finché non si ha quella piattaforma sotto mano:

- Windows e Linux lo mettono fra gli **argomenti** — del primo avvio, o
  dell'evento `second-instance` quando Filo è già acceso;
- Mac non li usa: consegna l'indirizzo con l'evento **`open-url`**, che può
  arrivare **prima** che l'app sia pronta (quindi l'ascoltatore si aggancia al
  livello del modulo, non dentro `whenReady`).

E fra gli argomenti l'indirizzo si **cerca**, scandendoli tutti per prefisso:
la posizione non è mai fissa (in sviluppo il secondo argomento è `.`, negli
spec `.` è l'ultimo), e chi prende `argv[1]` lo trova solo per caso.

**Dove vive.** `src/main/main.js` (`apriLinkFilo`, `apriInvitoDaArgv`,
`apriInvito`, `dichiaraProtocolloInvito`), le funzioni pure in
`src/shared/wallet.js` (`isInviteDeepLink`, `inviteCodeFromDeepLink`,
`filoUrlFromArgv`) e le sentinelle in `tests/unit/macSupport.test.mjs`, che
diventano rosse se sparisce uno dei due rami o se `protocols` esce dalla
ricetta del pacchetto.
