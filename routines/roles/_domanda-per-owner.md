## Una domanda per l'owner si scrive per lui

Il file è un JSON coi campi di SPEC-DOMANDE § 3.1: `titolo` e `priorita`
(`bloccante`, `importante` o `quando_puoi`) sono obbligatori; poi `contesto`,
`problema`, `opzioni` (ognuna `{ "testo", "pro", "contro", "azione": { "tipo",
"feedbackId" } }`), `consiglio` (`{ "opzione": <indice da 0>, "perche" }`),
`collegamenti` (`[{ "tipo": "feedback", "id" }]`), `notePerAgenti`, `gruppo`,
`blocca`.

La forma, che la validazione comune controlla e rifiuta dicendo il campo:

- il `titolo` ha al più 10 parole: dice di cosa si parla, il resto va nel
  contesto;
- almeno due `opzioni`, ognuna col suo pro e il suo contro. Un'opzione sola
  non è una domanda: è un feedback, o una nota. Se resta una strada sola,
  aggiungi quella che il caso ammette davvero (archiviare il lavoro, tenerlo
  com'è), non una finta;
- un resoconto senza niente da decidere non è una domanda: va nel report o
  nelle note del feedback.

Prima di chiedere cerca nel registro delle decisioni già prese:
`node scripts/domanda.mjs registro <poche parole>`. Se un principio risponde,
applicalo e citalo nel report invece di chiedere. Se il tuo biglietto non può
leggere il registro te lo dice: chiedi lo stesso.

Ogni domanda, prima di arrivare all'owner, la smista un agente: la chiude da
solo se è un guasto o se un principio la copre, e altrimenti la riscrive corta
per lui. Il tuo testo resta intero nelle note per chi riprende: scrivilo
comunque per l'owner, con quello che hai capito.

`blocca` (`true` o `false`) dice se la domanda ferma il lavoro su `payload.id`
finché l'owner non risponde, e lo decidi tu quando un'opzione lo riprende
(`riprendi` su `payload.id`): con `domanda.mjs chiedi`, senza, la domanda è
rifiutata. Blocca se andare avanti con la consigliata, e poi l'owner sceglie
altro, lascia un danno che un altro giro non rimedia (soldi, dati dell'utente,
sicurezza e segreti, politica sui modelli, terzi, account e credenziali), o se
serve un fatto che sa solo l'owner; nel dubbio blocca. Con `false` il lavoro va
avanti con la consigliata, che resta scritta come decisione provvisoria: se
l'owner sceglie altro riparte con la sua scelta, anche se è già fuso. Una
fermata (`--status design`) blocca da sé, e lì `false` è rifiutato.

L'owner non legge il codice. Prima di mandare una domanda applica
`.claude/skills/unslop/SKILL.md` a titolo, contesto, problema, opzioni (testo,
pro, contro) e consiglio, e controlla che:

- non ci siano nomi di file, funzioni, rami, commit o comandi;
- un errore sia detto in italiano, con parole tue: cosa non va e cosa comporta;
- il problema finisca con una frase su cosa deve fare lui;
- ogni opzione abbia un pro vero: quella che non ce l'ha si toglie, invece di
  scrivere «Nessuno».

I dettagli tecnici e i messaggi esatti vanno in `notePerAgenti`, che resta
libero. `domanda.mjs chiedi` rifiuta un nome di file di codice, una lineetta
(— o –) o un pro vuoto in un campo per l'owner, e dice quale campo e cosa
togliere.
