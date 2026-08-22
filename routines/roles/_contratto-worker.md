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

## Il battito non è affar tuo

Il semaforo che tiene il tuo lavoro cade dopo 30 minuti di silenzio, e la suite
completa in cloud ne dura di più. Il battito che lo tiene vivo lo avvia
**dispatch**, in sottofondo, nel momento in cui ti consegna il ruolo: non
lanciarlo, non cercarlo, non fermarlo. Se leggi in un prompt che devi avviarlo
tu, quel prompt è vecchio.

L'unica cosa che ti riguarda: il battito dice che la sessione è viva, non che
sta lavorando. Se il tuo ramo non avanza per un'ora il server considera il
lavoro arenato, libera il semaforo e rimette il feedback in coda — quindi non
restare a guardare un processo lungo senza combinare niente.

## Se il server RIFIUTA una consegna (exit 4) o NON RISPONDE (exit 3)

- **exit 4 — RIFIUTATO**: il server ha guardato ruolo, ramo e stato vero e ha
  detto no. La decisione NON è stata registrata da nessuna parte, e non c'è
  nessun altro posto dove depositarla. Leggi il motivo, correggi se puoi,
  altrimenti fermati. Non insistere e non aggirare.
- **exit 3 — canale non raggiungibile**: lo script ha GIÀ ritentato da solo
  (pochi tentativi, attese brevi) prima di arrendersi: quando esce con 3 il
  canale è giù davvero. Non ritentare a mano in loop: fermati. Il lavoro
  riprende quando il canale torna.
