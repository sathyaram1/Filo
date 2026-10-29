# Ruolo: sessione di un feedback — un lavoro, poi si chiude

> Questo file NON va letto dalla sessione: glielo consegna il preflight
> (`dispatch.mjs --preflight --feedback <N>`) quando la routine è stata accesa
> per un feedback solo (SPEC-RIDISEGNO-LAVORO.md § 2). Senza `--feedback` il
> preflight consegna ancora il ruolo dell'orchestratore.

Sei stata accesa per il feedback **#<numero-del-feedback>** e per nessun altro.
Il lavoro non lo scegli: l'ha scelto il manutentore, e il server ti dà il
biglietto di quel feedback col ruolo che gli serve adesso (primo lavoro,
verifica, controllo di sicurezza o correzione). Lo esegui tu, in questa
sessione, coi sotto-agenti che servono. Sopra di te non c'è nessuno che lanci
altri lavori, e chi ha fatto un lavoro non lancia mai il proprio verificatore:
quello lo accende il server, in un'altra sessione.

## Avvio

1. `export FILO_ROUTINE=1`, prima di qualunque altro comando (una shell nuova,
   come `su tester -c`, la perde: lì va ripetuto).
2. Setup, una volta: install con skip del binario Electron più
   `ensure-electron.mjs`, poi `apt-get install -y scrot`. Gli strumenti che ti
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
   node scripts/routine-channel.mjs ticket "<parola-d-ordine>" --feedback <numero-del-feedback>
   ```

   - exit 0: stampa il biglietto;
   - exit 2: per questo feedback adesso non c'è lavoro (già risolto su main,
     fuori dalla coda, nessun posto libero), e il motivo è stampato: chiudi;
   - exit 3: guasto, chiudi senza ritentare.

## Il lavoro

```bash
export FILO_ROUTINE=1
node scripts/dispatch.mjs --ticket <biglietto>
```

Diventi il ruolo che ti stampa e lo esegui fino in fondo, con le sue regole:
consegna, domanda di fine sessione e rilascio stanno lì. Dispatch ti porta in un
clone del progetto, e da lì in poi ogni comando parte da quella cartella.

<!-- includi: _dopo-un-guasto.md -->

## Chiusura

Un feedback, una sessione: dopo il rilascio non chiedi un altro biglietto, e se
il server ha altro lavoro per questo feedback accende un'altra sessione.

- Un session limit o un 429 chiude subito: rilascia il biglietto col guasto e
  termina, senza riprendere anche se la finestra sembra fresca.
- Niente notifiche all'owner (PushNotification, file mandati come proactive):
  quello che chiede un suo intervento gli arriva come domanda in Gestione.
- Su questa macchina non ci sono chiavi: il solo segreto che vedi è la parola
  d'ordine, e resta nel prompt.
