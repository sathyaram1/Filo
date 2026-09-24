# Lo stato che deve durare non si appunta sul messaggio

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Uno stato che deve sopravvivere a più messaggi si tiene su una
cosa che dura davvero — la scheda, la sessione, l'utente — e mai sull'oggetto
che descrive il MITTENTE di un messaggio: quello viene costruito da capo a ogni
messaggio, quindi scriverci sopra è scrivere sull'acqua. Il sintomo è
crudele perché non è un errore: la prima volta funziona, il secondo messaggio
riparte da zero, e se il valore perso è un default innocuo (la cartella
personale, la lingua di sistema, il primo elemento) nessuno vede un guasto —
vede un comportamento «strano».

## Il caso

Feedback #551, terzo giro di verifica. Filo tiene la cartella di lavoro del
terminale fra un comando e l'altro, ed è una promessa scritta nelle istruzioni
che il modello riceve: «la cartella di lavoro è PERSISTENTE, un `cd` resta
valido per i comandi successivi». La cartella veniva appuntata sul mittente:

```js
function setAssistantCwd(sender, cwd) {
  if (sender) { try { sender._filoAssistantCwd = cwd; } catch (_) {} }
  else _assistantCwdFallback = cwd;
}
```

Il mittente però è quello che `senderInfo(event)` costruisce in
`src/main/ipc.js`: un oggetto letterale, nuovo a ogni messaggio in arrivo da una
pagina. Dentro UN turno di chat regge — l'assistente lancia più comandi di fila
riusando lo stesso oggetto — ma appena arriva un messaggio nuovo l'appunto non
c'è più e `getAssistantCwd` ripiega sulla home.

Due danni, molto diversi fra loro.

Il primo è la lamentela della segnalazione per un'altra strada: Filo entra nei
Documenti, elenca, trova il file; l'utente scrive di nuovo, Filo cerca nella
cartella personale e risponde che quel file non esiste.

Il secondo è peggio. Un comando che modifica si ferma e chiede conferma, e il
popup dice in quale cartella scriverà — è l'unica difesa che l'utente ha, visto
che il testo del comando da solo non lo dice. La conferma è **per forza** un
messaggio nuovo. Quindi il comando approvato per una cartella veniva eseguito
nella cartella personale: una cancellazione confermata per la cartella dei
temporanei girava sui file di casa.

## I tentativi sbagliati

**Provarlo chiamando l'azione dall'interno.** I due giri di verifica
precedenti avevano una prova verde intitolata «la cartella corrente continua a
persistere fra un comando e l'altro». Chiamava l'azione direttamente nel
processo principale, senza mittente — e senza mittente l'appunto finiva nella
variabile condivisa, che invece sopravvive. La prova era verde e l'app era
rotta. Una prova che non prende la strada dell'app non prova niente: se lo
stato dipende da CHI manda il messaggio, il mittente della prova deve essere
quello vero.

## La cura

La scheda dura: i suoi `webContents` sono lo stesso oggetto per tutta la vita
della scheda, e `senderInfo` se li porta dietro (`wc`). La cartella si tiene lì,
con una `WeakMap`, così l'appunto muore con la scheda come prima e non trattiene
niente in memoria.

```js
const _assistantCwdByTab = new WeakMap();
function assistantCwdTab(sender) {
  const wc = sender && sender.wc;
  return wc && typeof wc === 'object' ? wc : null;
}
```

Il ripiego condiviso resta per le chiamate interne, che un mittente non ce
l'hanno.

## Dove guardare

- `src/main/services/handlers.js` — `getAssistantCwd` / `setAssistantCwd`.
- `src/main/ipc.js` — `senderInfo`: qui si vede che il mittente è nuovo ogni
  volta.
- `tests/terminal-mode.spec.mjs` — le due guardie: la cartella vale ancora al
  messaggio dopo, e un comando confermato scrive dove il popup aveva detto.

## Uno stato che dura va ricontrollato prima di usarlo

Farlo durare apre la porta gemella: il mondo, intanto, cambia. La cartella
appuntata può essere stata rinominata, cancellata, o stare su una chiavetta che
l'utente ha staccato. Avviare una shell lì dentro non fa fallire il comando: fa
fallire la SHELL, prima ancora di leggerlo, e il motivo che ne esce parla del
programma («spawn … ENOENT») invece che della cartella. Siccome l'appunto resta,
il comando dopo cade uguale, compreso quello per andarsene: in quella scheda il
terminale è finito finché l'utente non la chiude.

Finché lo stato durava un messaggio il guasto si curava da solo al messaggio
dopo. Facendolo durare quanto la scheda, si è fatto durare anche questo. Quindi
un appunto che dura si CONTROLLA quando lo si usa, con un ripiego sicuro (la
home, da dove il terminale parte), e il ripiego si DICHIARA a chi legge:
altrimenti il modello continua a ragionare su una cartella che non esiste e
all'utente racconta un guasto che non c'è.

La misura di quanto due strade divergono: la shell persistente del terminale
che l'utente digita a mano quel controllo ce l'aveva da sempre, e infatti
davanti alla stessa cartella sparita riparte dalla home e continua a
funzionare. La domanda adesso si fa in un posto solo, `cartellaPerComando` in
`src/main/services/shell.js`, e la fanno tutti e tre quelli che la facevano
per conto loro: la shell persistente, il comando one-shot dell'assistente e il
popup che dice all'utente dove quel comando scriverà.
