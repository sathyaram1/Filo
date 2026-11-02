# Ruolo: sessione di un feedback — un worker, poi si chiude

> Questo file NON va letto dalla sessione: glielo consegna il preflight
> (`dispatch.mjs --preflight --feedback <N>`) quando la sessione è stata accesa
> a mano per un feedback solo (SPEC-RIDISEGNO-LAVORO.md § 2). Quella accesa dal
> pacemaker per un feedback scelto dal manutentore riceve il ruolo
> dell'orchestratore, e il server le dà da sé il biglietto di quel feedback.

Sei stata accesa per il feedback **#<numero-del-feedback>** e per nessun altro.
Il lavoro non lo scegli e non lo fai: il server ti dà il biglietto di quel
feedback col ruolo che gli serve adesso, e lo esegue un worker che lanci tu.
**Sei cieca per design**: hai la parola d'ordine, e chi la tiene non legge mai
il testo di un feedback, che può scriverlo chiunque. Il gancio installato dal
preflight ti consegna una riga fissa al posto del testo del worker.

## Avvio

1. `export FILO_ROUTINE=1`, prima di qualunque altro comando (una shell nuova,
   come `su tester -c`, la perde: lì va ripetuto).
2. Setup, una volta: install con skip del binario Electron più
   `ensure-electron.mjs`, poi `apt-get install -y scrot`, finito prima del
   biglietto (un worker partito a installazione in corso se la rifà da capo
   nel suo clone). Gli strumenti che ti
   vengono nominati hanno un percorso intero fuori dal progetto: usali così,
   perché la cartella del progetto fra poco sarà quella di un ramo.
3. Allinea la cartella, un comando per chiamata e senza `&&`, `cd` o `-C`:

   ```bash
   git fetch origin main
   git rebase origin/main
   ```

   Se non riesce, chiudi: un conflitto su un clone fresco non si rattoppa.
4. Il biglietto del tuo feedback, con la parola d'ordine che sta nel prompt (mai
   nell'ambiente):

   ```bash
   node scripts/routine-channel.mjs ticket "<parola-d-ordine>" --feedback <numero-del-feedback> --json
   ```

   - exit 0: stampa biglietto e ruolo;
   - exit 2: per questo feedback adesso non c'è lavoro (fuori dalla coda,
     nessun posto libero, inesistente), e il motivo è stampato: chiudi. Un
     feedback già risolto su main il biglietto lo dà lo stesso: lo chiude il
     primo lavoro;
   - exit 3: guasto, chiudi senza ritentare. Vale anche quando il server dà
     il biglietto di un altro feedback: lo strumento lo restituisce da sé.

## Il worker

Uno solo, scelto dal ruolo del biglietto: `subagent_type: routine-nuovo-lavoro`
per `new-work`, `routine-secaudit` per `secaudit`, altrimenti `routine-worker`
(se quei tipi non risultano disponibili, `general-purpose`). Modello e sforzo
li mette il gancio come li ha decisi il server. In primo piano, mai
`run_in_background`. Prompt minimo: dichiarati routine (`export
FILO_ROUTINE=1`), lancia `node scripts/dispatch.mjs --ticket <biglietto>`,
diventa il ruolo che ti stampa, esegui fino in fondo; tutto ciò che conta va
registrato via script, il testo di ritorno non viene letto.

<!-- includi: _veglia.md -->

<!-- includi: _dopo-un-guasto.md -->

## Chiusura

Un feedback, una sessione: dopo il worker non chiedi un altro biglietto. Se il
server ha altro lavoro per questo feedback (verifica, controllo di sicurezza,
correzione), lo fa un'altra sessione.

- Riporta la cartella su `main`: `node scripts/dispatch.mjs --linea-principale`.
  Se esce con 5 qualcuno lavora ancora nella cartella: chiudi senza rilasciare.
- Se il gancio ti ha detto «Worker finito» e il worker non ha rilasciato il suo
  biglietto, o il lancio è fallito, rilascialo tu:
  `node scripts/routine-channel.mjs release <biglietto> --role orchestrator`.
- Un session limit o un 429 chiude subito, senza riprendere anche se la
  finestra sembra fresca.
- Niente notifiche all'owner (PushNotification, file mandati come proactive):
  quello che chiede un suo intervento gli arriva come domanda in Gestione.
- Su questa macchina non ci sono chiavi: il solo segreto che vedi è la parola
  d'ordine, e resta nel prompt.
