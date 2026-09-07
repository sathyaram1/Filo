# Azione distruttiva: l'"Annulla" effimero non può essere l'UNICA rete

[← Tutti i pattern](../PATTERNS.md)

Rendere un'eliminazione **immediata e reversibile** (niente conferma, un avviso
con "Annulla" subito dopo) è la scelta giusta per l'attrito — ma l'undo nel
toast è una **scorciatoia**, non la rete di sicurezza: dura pochi secondi, muore
col reload e vive in un pezzo di UI che altri eventi possono sovrascrivere.

- Dietro l'undo effimero serve **uno stato persistente**: un cestino con gli
  ultimi N eliminati (contenuto + dati collegati), raggiungibile dalla UI e
  vivo dopo la chiusura della pagina. L'undo diventa allora solo il cammino
  veloce sullo stesso stato.
- **Non buttare i dati collegati** (storico versioni, allegati) all'atto
  dell'eliminazione: vanno liberati quando l'elemento esce davvero dal cestino,
  altrimenti il ripristino torna monco.
- Se l'eliminazione ha creato **qualcosa al posto** dell'elemento tolto (il
  foglio bianco quando si cancella l'ultimo documento), all'undo rimuovilo
  **solo se è rimasto vuoto**: nel frattempo può essere diventato un contenuto
  vero, e toglierlo sarebbe la stessa perdita che stai prevenendo.
- L'unica azione **irreversibile** (svuotare/eliminare per sempre) chiede
  conferma sul posto — il bottone diventa "Confermi?" e torna com'era da solo —
  senza aprire finestre di mezzo.
- **Dove:** cestino documenti dell'editor (`deleteFile`/`restoreDeletedFile`/
  pannello `Cestino` in `src/pages/editor/editor.js`), test
  `tests/editor-trash.spec.mjs`.
