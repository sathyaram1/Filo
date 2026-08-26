# Contratto comune dei worker

> Questo blocco viene ACCODATO da dispatch alle istruzioni di ogni ruolo
> lavorante (il file inizia con `_` perché non è un ruolo: da solo non viene
> mai consegnato).

## Il tuo testo di ritorno NON è un canale

Quello che scrivi alla fine della sessione non viene letto da nessuno:
l'orchestratore decide il passo successivo interrogando uno script, mai
leggendo le tue parole. È una difesa: un worker catturato da una prompt
injection non deve poter parlare all'orchestratore. (Ed è la fine di una
violazione cronica: i worker restituivano report interi che l'orchestratore
doveva fingere di non vedere.)

Conseguenza pratica: TUTTO ciò che deve sopravvivere alla tua sessione va
REGISTRATO con gli script, mentre lavori:

- l'esito del tuo ruolo → i comandi di registrazione/consegna del tuo
  file-ruolo;
- i testi per l'owner e per chi ha segnalato → nelle `notes` via canale;
- il claim → il rilascio, quando hai finito;
- un guasto che ti impedisce di lavorare → dichiaralo AL CANALE nel rilascio,
  col motivo (`node scripts/routine-channel.mjs release <biglietto>
  --guasto "<motivo>"`): è così che il server smette di dare lavoro per
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

Il semaforo che tiene il tuo lavoro cade dopo 30 minuti di silenzio, e la suite
completa in cloud ne dura di più. Il battito che lo tiene vivo lo avvia
**dispatch**, in sottofondo, nel momento in cui ti consegna il ruolo: non
lanciarlo, non cercarlo, non fermarlo. Se leggi in un prompt che devi avviarlo
tu, quel prompt è vecchio.

L'unica cosa che ti riguarda: finché il battito arriva, il tuo lavoro è tuo e
nessuno te lo toglie, per quanto a lungo tu ci stia. Il server rimette in coda
da solo i lavori di chi il battito l'ha perso — sessione morta, rete caduta,
tetto delle otto ore — e lì guarda da quando il ramo non si muove. Quindi
l'unica cosa da NON fare è morire in silenzio: se ti accorgi che non puoi
proseguire, dichiaralo nel rilascio invece di lasciare il lavoro appeso.

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
