# Aprire una scheda: primo piano solo se l'utente vuole ARRIVARCI

`TabManager.openTab(url, { activate })` decide se la nuova scheda passa davanti.
Attivarla è il default (chi chiede "apri X" vuole vedere X), ma **non è sempre
giusto**: la musica che Filo mette per te, il Ctrl+click su un link mentre stai
leggendo, le schede ripristinate all'avvio non devono strapparti da dove sei.

- **Agente:** l'azione `NAVIGA` accetta `background: true` (il prompt gli spiega
  quando usarlo: ciò che si ascolta e basta, o "senza cambiare scheda").
- **Gesti del browser:** `setWindowOpenHandler` apre dietro quando la
  `disposition` è `background-tab` (Ctrl+click, click centrale).
- **Vincolo tecnico da non rompere:** una scheda di sottofondo NON va nascosta
  con `setVisible(false)` — per Chromium diventerebbe una scheda "hidden" e i
  media potrebbero non partire. Si lascia visibile con bounds `{0,0,0,0}`
  (`layout()` lo fa da sé per ogni scheda non attiva).
- **Invariante UX:** se Filo apre qualcosa dietro, il riferimento che lascia in
  chat deve **portare a quella scheda** (messaggio `FOCUS_TAB`), non aprirne un
  doppione sullo stesso indirizzo.
