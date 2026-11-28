# Il tasto destro è a icone, e ogni sua azione sta nell'elenco unico

[← Tutti i pattern](../PATTERNS.md)

Il menu del tasto destro di Filo mostra solo icone, per ogni utente, sopra le schede e nei menu propri delle pagine
filo:// (#2555). Restano testo solo le spiegazioni, le proposte (le correzioni del correttore) e le voci il cui
contenuto è un dato (la cronologia degli appunti, i gruppi di «Sposta in…», i valori di un'icona, l'ordine della
Gestione).

## La regola

- **Una voce nuova entra nell'elenco unico**, `VERBI` in `src/shared/disposizioneIcone.js`: nome breve (1-3 parole,
  quello della riga del nome), icona, verbo, tasto singolo, e le parole con cui un'etichetta scritta lo nomina. Per un
  contesto del tasto destro va anche in `CONTESTI` (griglia o «+», e gli oggetti in ordine). La sentinella
  `tests/unit/azioniDelMenu.test.mjs` vuole icona e nome, icone e tasti diversi nello stesso menu, e le etichette delle
  pagine riconosciute.
- **Un verbo, un'icona.** Lo stesso verbo su più oggetti (la selezione, l'immagine, il suo indirizzo, il collegamento)
  è un'icona sola: il clic agisce sul primo oggetto dell'elenco che l'elemento ha (con una selezione «Copia» copia
  lei), gli altri stanno nel menu dell'icona (tasto destro sull'icona, tasto Menu o Maiusc+F10), segnato da un punto.
  Il menu dell'icona non ha un livello sotto.
- **Il nome sta in una riga del menu** («nome · oggetto · tasto»), senza ritardo: dentro il menu niente fumetto vicino
  al puntatore, coprirebbe le icone accanto (`filo_design.txt` § hover). Passando su un'icona l'oggetto su cui agirebbe
  si contorna nella pagina: è ciò che rende sicura l'icona unica.
- **Valori e stati.** Un'azione con un valore (velocità, dimensione della pagina) ha il valore come icona: il clic apre
  i valori, la rotella lo cambia. Acceso o spento (l'audio, ripeti) si vede sull'icona.
- **Le voci scritte delle pagine di Filo** (`SN_VOCI_PAGINA`, i menu propri) passano da `SN_MENU_ICONS.apriVoci` o
  dal menu generale: il verbo lo prende la prima parola dell'etichetta, il resto è l'oggetto. Una voce che nessun
  verbo riconosce avrebbe l'icona generica: si aggiunge il verbo, non si lascia. Se il verbo c'è già nella griglia
  (il collegamento di una pagina del filo, «Riapri la pagina» contro «Apri in nuova tab») la voce della pagina prende
  il clic, e l'azione generica passa nel menu dell'icona; con una selezione il clic resta alla selezione.

## Dove sta

- Elenco e disposizione: `src/shared/disposizioneIcone.js`. Chi costruisce la griglia: `src/content/menuIcons.js`
  (`fila`, `apriVoci`, e il passaggio che porta nella griglia ogni voce scritta rimasta fuori). Chi la disegna:
  `src/content/menu.js` (`costruisciGriglia`), anche nello strato (`src/pages/menu/menu.js` porta i contorni nei suoi
  px e fa Incolla dal main).
- Le azioni di ogni contesto e chi le esegue: `azioniDelContesto` in `src/content/content.js`.
- Grandezza delle icone e colonne: `menuIcone` nelle impostazioni (Preferenze → Avanzate → Tasto destro, e a parole).
- Prova: `tests/menu-a-icone.spec.mjs`.

## Fuori

Il riquadro di sistema della home (ora, rete, volume) non è un menu ma un riquadro con i suoi comandi: resta com'è.
L'ordine dall'uso, il trascinamento e le combinazioni di tasti a menu chiuso sono il pacchetto 2.
