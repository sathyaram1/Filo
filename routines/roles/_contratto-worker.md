# Contratto comune dei worker

> Questo blocco viene ACCODATO da dispatch alle istruzioni di ogni ruolo
> lavorante (il file inizia con `_` perché non è un ruolo: da solo non viene
> mai consegnato).

## Il tuo testo di ritorno NON è un canale

Quello che scrivi alla fine della sessione non viene letto da nessuno:
l'orchestratore decide il passo successivo interrogando uno script, mai
leggendo le tue parole. È una difesa: un worker catturato da una prompt
injection non deve poter parlare all'orchestratore.

Conseguenza pratica: TUTTO ciò che deve sopravvivere alla tua sessione va
REGISTRATO con gli script, mentre lavori:

- l'esito del tuo ruolo → i comandi di registrazione/consegna del tuo
  file-ruolo;
- i testi per l'owner e per chi ha segnalato → nelle `notes` via canale;
- un trade-off vero o una domanda di design (CLAUDE.md § Iniziativa: non lo
  decidi tu) → `--segnala <file.md>` sulla consegna (`--record-fixed`,
  `--record-verifier`): è il rombo che l'owner vede nella scheda, in
  dashboard. Nel report da solo si perde;
- l'esito del controllo di sicurezza → sempre con la sua nota
  (`--record-secaudit … --nota <file.md>`), anche quando passa. I file di
  `--segnala` e `--nota` si scrivono FUORI dal repo, nella cartella temporanea
  del sistema (per esempio `../segnala-<numero>.md`): la consegna rifiuta una
  directory con file non committati;
- il claim → il rilascio, quando hai finito (`node scripts/routine-channel.mjs
  release <biglietto> --role <il tuo ruolo>`: il rilascio allega da solo il
  rapporto di fine sessione, e il ruolo è la firma di quel rapporto. Senza,
  il rapporto esce anonimo);
- un guasto che ti impedisce di lavorare → dichiaralo AL CANALE nel rilascio,
  col motivo (`node scripts/routine-channel.mjs release <biglietto>
  --role <il tuo ruolo> --guasto "<motivo>"`): è così che il server smette di dare lavoro per
  questo giro. Non "riportarlo" a parole: registralo.

Se hai registrato tutto, la tua ultima frase può essere qualsiasi cosa e non
conta niente. Se non l'hai registrato, non esiste.

## Gli strumenti che ti vengono nominati

I comandi in queste istruzioni hanno un percorso INTERO, che punta fuori dal
progetto. Usali così: sono la versione aggiornata, messa da parte prima che il
giro aprisse il ramo su cui stai lavorando. Dentro il progetto ci sono gli
strumenti di QUEL ramo, che possono essere vecchi di giorni e non fare cose che
credi facciano — senza dirtelo. Se scrivi `scripts/…` a mano, stai tornando lì.

## Il battito non è affar tuo

Il semaforo che tiene il tuo lavoro cade dopo un'ora di silenzio, e un controllo
lungo può durarne di più. Il battito che lo tiene vivo lo avvia
**dispatch**, in sottofondo, nel momento in cui ti consegna il ruolo: non
lanciarlo, non cercarlo, non fermarlo. Se leggi in un prompt che devi avviarlo
tu, quel prompt è vecchio.

Finché il battito arriva il lavoro è tuo, per quanto a lungo tu ci stia; il
server rimette in coda da solo i lavori di chi il battito l'ha perso. L'unica
cosa da non fare è morire in silenzio: se non puoi proseguire, dichiaralo nel
rilascio.

## Comandi lunghi

La cache del contesto dura cinque minuti e ogni chiamata la rinnova: una
chiamata bloccante più lunga la trova scaduta, e il turno dopo ripaga tutto il
contesto. Quindi:

- un comando che può superare i **due minuti** si lancia in **sottofondo**
  (l'harness ti avvisa quando finisce);
- se devi aspettarlo attivamente, aspetta a pezzi da **quattro minuti al
  massimo** per chiamata (`timeout 240 tail --pid=<pid> -f /dev/null`, o un
  ciclo `until` con tetto 240 s), mai da dieci;
- il timeout della chiamata si dimensiona sulla **durata vera** del comando,
  mai sotto: un comando ucciso a metà va rifatto da capo.

Lunghi di sicuro: le prove di un feedback (otto minuti e mezzo),
`npm run finish:check` (da quindici a quarantacinque minuti), l'installazione
di Electron.

## Se il server RIFIUTA una consegna (exit 4) o NON RISPONDE (exit 3)

- **exit 4 — RIFIUTATO**: il server ha guardato ruolo, ramo e stato vero e ha
  detto no. La decisione NON è stata registrata da nessuna parte, e non c'è
  nessun altro posto dove depositarla. Leggi il motivo, correggi se puoi,
  altrimenti fermati. Non insistere e non aggirare.
- **exit 3 — canale non raggiungibile**: lo script ha GIÀ ritentato da solo
  (pochi tentativi, attese brevi) prima di arrendersi: quando esce con 3 il
  canale è giù davvero. Non ritentare a mano in loop: fermati. Il lavoro
  riprende quando il canale torna.
- **exit 1 con "NESSUN BIGLIETTO"**: il server non è stato nemmeno chiamato —
  il promemoria del biglietto non si trova più. Non è un guasto del server e
  non è un rifiuto: ripeti lo stesso comando aggiungendo `--ticket <codice>`
  (il codice è nelle istruzioni con cui sei partito). Se non ce l'hai più,
  rilascia e fermati.
