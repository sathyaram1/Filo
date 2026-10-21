# Il colore di una card dice che DECISIONE serve, non lo stato interno

[← Tutti i pattern](../PATTERNS.md)

Nella dashboard di gestione lo stesso stato può avere origini diverse (un `design`
può venire dai giudici, da domande della routine, o da un fix bocciato dalla
sicurezza), e un dato mostrato può risalire a PRIMA dello stato attuale (i pallini
dei giudici raccontano il voto d'ingresso, che può essere tutto blu su un feedback
poi bocciato). Due regole (#462, #238):

- **Il colore segue il tipo di decisione chiesta all'owner**, non il nome dello
  stato: una bocciatura di sicurezza è rossa anche se lo stato si chiama `design`;
  un fidato segnalato dal panel completo mostra la categoria segnalata, non il
  bianco "non filtrato" (che significherebbe "c'è ancora da giudicare": falso).
- **Accanto ai dati storici, una frase che spiega lo stato di OGGI** (`judgesNote`
  in `manageReview.js`): senza, storia e stato sembrano in contraddizione e
  l'owner cerca un bug della dashboard. I codici interni (`secaudit`, `clarify`)
  non si mostrano mai grezzi: `reasonText` li traduce.
- **Dove:** `classifyBlock`/`judgesNote`/`reasonText` in `src/shared/manageReview.js`,
  resa in `renderJudgesRow` (`manage.js`). Test: `tests/unit/manageReview.test.mjs`,
  `tests/manage-page.spec.mjs` (secaudit rosso + frase; fidato segnalato fuori dal
  «Ri-valuta»).
- **Il colore non è l'unico segnale** (D93, #603): «bloccato dalla sicurezza» e
  «attacco» hanno lo stesso rosso, e tre lavori pronti da fondere sembravano
  attacchi. Ogni scheda dei Ricevuti porta accanto al titolo la FORMA del
  livello che l'ha fermata, la stessa della fila nel dettaglio (triangolo
  filtro, cerchio giudici, rombo Claude che chiede, pentagono audit, quadrato
  fusione), con il motivo in parole sotto il puntatore. Un rimando che chiede
  lavoro locale è un'altra decisione, quindi un altro colore: rombo azzurro come
  lo schermo di 💻 (#1060), in lista e nella fila, dove si colora dallo stato. Il bordo resta la
  famiglia del motivo. Il segno sparisce quando la pratica esce dai Ricevuti
  (una risposta partita la rimette in coda). Stessa regola nella pagina dei
  feedback. Fonte unica: `segnoFermata` in `manageReview.js`.
- **La fiducia ha un canale suo** (#1575): il bordo sinistro è già la decisione, quindi se
  una pratica è fidata lo dicono il bordo DESTRO e uno scudo in fondo alla riga, pieno se
  fidata e vuoto tratteggiato se no (mai il solo colore), in tutte le schede, nella ricerca,
  nel pannello del mittente e nelle Domande. Muschio e prugna, token `--mg-fidata-color` e
  `--mg-nonfidata-color` con la variante scura, lontani dai colori delle decisioni. L'hover
  dice che è la fiducia del FEEDBACK: il cancello guarda anche il registro del ramo, che la
  pagina non legge. «Solo non fidate» filtra e conta con `filtraFiducia`, la stessa funzione
  per pratiche e domande. Prove: `tests/manage-fiducia.spec.mjs`.
