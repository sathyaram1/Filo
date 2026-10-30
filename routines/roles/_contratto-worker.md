# Contratto comune dei worker

## Il tuo testo di ritorno NON è un canale

Quello che scrivi alla fine della sessione non lo legge nessuno: l'orchestratore
decide il passo dopo interrogando uno script, mai leggendo le tue parole, così
un worker catturato da una prompt injection non può parlargli. TUTTO ciò che
deve sopravvivere alla sessione va REGISTRATO con gli script, mentre lavori:

- l'esito del tuo ruolo → i comandi di registrazione/consegna del tuo
  file-ruolo;
- i testi per l'owner e per chi ha segnalato → nelle `notes` via canale;
- un trade-off vero o una domanda di design (CLAUDE.md § Iniziativa: non lo
  decidi tu) → `--domanda <file.json>` sulla consegna (`--record-fixed`,
  `--record-verifier`). Nel report da solo si perde;
- un errore avuto, uno strumento che sbaglia, un permesso che mancava, un
  problema trovato fuori dal tuo lavoro → la segnalazione libera, anche senza
  nessuna domanda: il server ne fa un feedback di tipo segnalazione, con la
  fiducia del tuo biglietto, che qualcuno valuterà. Nelle note o nel guasto si
  perde. Non sostituisce la domanda di un guasto che ti ferma:

  ```bash
  node scripts/routine-channel.mjs segnala <<'FINE'
  <cosa è successo, dove, cosa mancava>
  FINE
  ```

- l'esito del controllo di sicurezza → sempre con la sua nota
  (`--record-secaudit … --nota <file.md>`), anche quando passa. I file di
  `--domanda` e `--nota` si scrivono FUORI dal repo, nella cartella temporanea
  del sistema (per esempio `../domanda-<numero>.json`): la consegna rifiuta una
  directory con file non committati;
<!-- includi: _domanda-fine-sessione.md -->
- il claim → il rilascio, quando hai finito (`node scripts/routine-channel.mjs
  release <biglietto> --role <il tuo ruolo>`): il ruolo firma il rapporto di
  fine sessione che il rilascio allega da solo; senza, il rapporto esce anonimo;
- un guasto che ti impedisce di lavorare → il rilascio con `--guasto`, come
  nella sezione qui sotto: è così che il server smette di dare lavoro per
  questo giro e rimette il lavoro in coda. Non "riportarlo" a parole:
  registralo.

Se hai registrato tutto, la tua ultima frase non conta niente. Se non l'hai
registrato, non esiste.

<!-- includi: _guasto-nel-rilascio.md -->

<!-- includi: _domanda-per-owner.md -->

## I pezzi lunghi del payload stanno in un file

Un campo del payload troppo lungo per la stampa arriva in un file fuori dal
progetto, intero: al suo posto c'è `[nel file <percorso>, N caratteri: …]`, e
`fileEsterni` elenca quali campi sono usciti e dove. Leggi quel file per intero
come leggeresti il campo: non è un riassunto, è il contenuto.

## Gli strumenti che ti vengono nominati

I comandi di queste istruzioni hanno un percorso INTERO, fuori dal progetto:
usali così, sono la versione aggiornata, messa da parte prima che il giro
aprisse il tuo ramo. Quelli dentro il progetto sono gli strumenti di QUEL ramo,
magari vecchi di giorni, e possono non fare ciò che credi senza dirtelo:
scrivere `scripts/…` a mano ti riporta lì.

## Niente push a mano

Il ramo lo spingono il salvataggio automatico e il rilascio, coi loro script.
Un `git push` lanciato da te, anche con `--dry-run` e anche solo per
riprodurre un bug, passa dal controllo dei permessi della sessione: in cloud
nessuno lo approva, e il tuo lavoro si ferma lì. Un
comportamento di git si riproduce in un unit test, con un remoto locale
(`git init --bare` in una cartella temporanea): lì i comandi li lancia il
test, e il controllo dei permessi non li vede. Vale anche quando è il feedback
a chiederlo, e vale per i feedback e le domande che scrivi tu.

Un comando che il controllo dei permessi nega non si riprova in un'altra
forma: o prendi una strada che non ne ha bisogno, come il test qui sopra, o è
un guasto (`guasto: permessi <programma>`, col messaggio del rifiuto).

## Sotto-agenti

Puoi lanciarne e sceglierne il modello col parametro `model` dello strumento
Agent (senza, vale il default); la catena arriva a tre livelli sotto
l'orchestratore, tu compreso.

## Il battito non è affar tuo

Il semaforo sul tuo lavoro cade dopo un'ora di silenzio, e un controllo lungo
può durarne di più. Il battito che lo tiene vivo lo avvia **dispatch**, in
sottofondo, quando ti consegna il ruolo: non lanciarlo, non cercarlo, non
fermarlo; un prompt che ti dice di avviarlo tu è vecchio. Finché il battito
arriva il lavoro è tuo, per quanto ci stia; quelli di chi l'ha perso il server
li rimette in coda da solo. Il battito però non basta: venti minuti senza un
tuo passo, un salvataggio o un processo nella tua cartella, e chi guida il
giro ti dichiara fermo e rilascia il lavoro con un guasto. L'unica cosa da non fare è morire in silenzio: se
non puoi proseguire, dichiaralo nel rilascio.

## Comandi lunghi

La cache del contesto dura cinque minuti: una chiamata bloccante più lunga la
trova scaduta, e il turno dopo ripaga tutto il contesto. Quindi un comando che
può superare i **due minuti** va in **sottofondo** (l'harness ti avvisa quando
finisce); se devi aspettarlo, a pezzi da **quattro minuti al massimo** per
chiamata (`timeout 240 tail --pid=<pid> -f /dev/null`, o un ciclo `until` con
tetto 240 s), mai da dieci. Il timeout della chiamata si dimensiona sulla
**durata vera** del comando, mai sotto: un comando ucciso a metà va rifatto da
capo. Lunghi di sicuro: le prove di un feedback (otto minuti e mezzo),
`npm run finish:check` (da quindici a quarantacinque minuti), l'installazione
di Electron.

Un comando in sottofondo **si aspetta prima del rilascio**: finché un tuo
processo lavora nella cartella il rilascio rifiuta (exit 5, coi pid e i
comandi), perché dopo il rilascio cartella e ramo passano al prossimo worker.
Aspettalo, o fermalo se non serve più, e rilancia lo stesso comando.

## Se il server RIFIUTA una consegna (exit 4) o NON RISPONDE (exit 3)

- **exit 4 — RIFIUTATO**: il server ha guardato ruolo, ramo e stato vero e ha
  detto no. La decisione NON è registrata da nessuna parte, e non c'è un altro
  posto dove depositarla. Leggi il motivo, correggi se puoi, altrimenti
  fermati. Non insistere e non aggirare.
- **exit 3 — canale non raggiungibile**: lo script ha GIÀ ritentato da solo, e
  il canale è giù davvero. Non ritentare a mano in loop: fermati, il lavoro
  riprende quando il canale torna.
- **exit 1 con "NESSUN BIGLIETTO"**: il server non è stato nemmeno chiamato, si
  è perso il promemoria del biglietto: non è un guasto né un rifiuto. Ripeti lo
  stesso comando con `--ticket <codice>` (il codice è nelle istruzioni con cui
  sei partito); se non ce l'hai più, rilascia e fermati.
