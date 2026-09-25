# Una scelta ricordata si ricorda intera

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Se una superficie ricorda una scelta dell'utente fra una sessione e
l'altra, ne ricorda tutte le parti. Una scelta ricordata a metà torna come una
scelta DIVERSA, e la pagina la presenta come se fosse quella di prima. Meglio
non ricordare niente: ripartire da un default dichiarato è onesto, tornare con
un mezzo stato non lo è.

## Il caso che l'ha fatta nascere

La scheda delle statistiche dei feedback (segnalazione #496) fa scegliere la
finestra di riferimento fra sei pasticche. L'ultima, «Scegli tu», apre due
campi data. Chi la usa sceglie un periodo stretto, guarda i numeri, chiude
Filo.

Alla riapertura la pagina ricordava la sola pasticca. I due campi tornavano
vuoti, e una finestra senza estremi vuol dire TUTTO: i numeri sullo schermo
erano quelli di sempre, sotto una pasticca accesa che prometteva un periodo
scelto dall'utente. Nessuna riga diceva quale periodo stava guardando davvero.
Provato con due segnalazioni, una dentro il periodo scelto e una di quaranta
giorni prima: prima della chiusura il riquadro scriveva 1, dopo la riapertura
scriveva 2.

Il filtro per mittente, sulla stessa barra, non si ricordava affatto: tornava
sempre su «Tutti». Due parti della stessa scelta, tre comportamenti diversi.

## Perché succede

La memoria nasce quasi sempre da un valore solo, quello che sembra «la
scelta»: una chiave in `localStorage` con dentro il nome della finestra. Le
parti che DEFINISCONO quella scelta (le due date) e quelle che la
accompagnano (il filtro) arrivano dopo, e nessuno torna a riguardare cosa si
salva. Il momento in cui si aggiunge la seconda parte è il momento in cui il
salvataggio va rifatto.

## Come si fa

Un oggetto solo, salvato e riletto in un punto solo, con dentro tutte le parti
della scelta. La rilettura VALIDA ogni pezzo (una data che non è una data si
butta, un mittente che non esiste più si butta) invece di farlo arrivare ai
conti. La vecchia chiave si continua a leggere come ripiego, così chi aveva già
scelto non riparte da zero.

Se una parte non la si vuole ricordare, allora non si ricorda nemmeno il resto:
quello che torna dev'essere la stessa scelta, o il default.

## Nel codice

- `src/pages/manage/manage.js`: `fsLeggiScelta` e `fsSalvaScelta`, la chiave
  `filo_manage_fs_scelta` (la vecchia `filo_manage_fs_range` resta come
  ripiego).
- I due campi data si riallineano a ogni disegno, tranne quello su cui sta
  scrivendo qualcuno: una data si legge a pezzi mentre la si scrive, e
  riscriverla sotto le dita la cancella.
- `tests/manage-statistiche-feedback.spec.mjs`: «la finestra scritta a mano e
  il filtro tornano interi alla riapertura».
