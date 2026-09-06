# Contenuto nascosto (sezioni chiuse, filtri, collassi): rivelalo, non toccarlo di nascosto

Se una parte del documento/lista è nascosta da un collasso o da un filtro, ogni
funzione che ci lavora sopra ha solo due comportamenti onesti: **includerlo E
rivelarlo**, oppure **escluderlo del tutto** (e non contarlo). La terza via —
contarlo e modificarlo lasciandolo invisibile — è la peggiore: il contatore
sembra mentire, i tasti di navigazione non portano da nessuna parte e le
modifiche si scoprono per caso più tardi (editor, Cerca/Sostituisci nelle
sezioni chiuse — #385).

- **Scelta di default: includere e rivelare.** L'utente ha cercato quella parola,
  non ha chiesto di limitare la ricerca a ciò che si vede; nascondere una
  corrispondenza legittima sarebbe attrito. Quindi la sezione si apre da sé e la
  vista ci arriva sopra. La stessa regola vale per "applica a tutti": ciò che
  viene toccato deve essere visibile **prima** che cambi.
- **Rivelare significa risalire la catena.** Un blocco può essere nascosto da un
  antenato di livello più alto, non dal titolo che gli sta subito sopra: si
  risale la catena dei titoli che lo governano e si riaprono tutti.
- **Rivelare per NAVIGARE è un prestito; rivelare per MODIFICARE è definitivo.**
  Aprire una sezione per mostrare dove sei è uno stato di passaggio: va marcato
  come tale (`data-search-opened` sul titolo) e **ritirato da solo** appena ti
  sposti su un altro risultato, svuoti il campo o esci. Altrimenti una ricerca
  incrementale (che riparte a ogni lettera e passa su corrispondenze che non
  c'entrano) smonta l'impaginazione costruita dall'utente, che deve richiudere
  tutto a mano (#385 bis). Se invece dentro quella sezione il testo è **cambiato**
  (Sostituisci / Sostituisci tutto), l'apertura resta: nascondere una modifica
  appena fatta è la stessa disonestà di prima.
- **Il prestito non vince mai sull'utente.** Una sezione che l'utente apre o
  chiude con la freccia, o in cui scrive, smette di essere in prestito e non si
  richiude più da sola: mai far sparire testo da sotto il cursore.
- **Una ricerca incrementale "va" sul risultato solo dopo una pausa** (~350ms):
  evidenziazione e contatore sono immediati (feedback subito), ma aprire sezioni
  e scorrere il documento a ogni lettera è attrito. La navigazione esplicita
  (Prec/Succ, Invio, sostituzione) salta la pausa.
- **Lo stato "chiuso" vive su una sola fonte di verità e le classi di
  visibilità si RICALCOLANO da lì** (nell'editor: `data-collapsed` sul titolo →
  `reapplyCollapseState()`). Togglare le classi in loco all'apertura sembra
  equivalente ma non lo è: riaprendo una sezione grande farebbe sbucare anche le
  sotto-sezioni che l'utente aveva chiuso.
- **Dove:** `revealCollapsedFor` / `reapplyCollapseState` in
  `src/pages/editor/editor.js`. Test `tests/editor-find-collapsed.spec.mjs`.
