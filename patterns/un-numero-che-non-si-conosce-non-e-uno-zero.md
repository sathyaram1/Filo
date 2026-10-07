# Un numero che non si conosce non è uno zero

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando la sorgente di un conteggio non ha risposto, il conteggio
non vale zero: non si sa. Il conto torna `null` e chi disegna scrive un
trattino, non uno zero. La riga che spiega il guasto serve lo stesso, ma non
basta da sola: sta in dodici pixel sopra la pagina, e il numero è grande
trenta in mezzo allo schermo. Vince il numero.

## Da dove viene

Feedback #496, la scheda «Statistiche feedback» di Gestione. Quella scheda si
nutre di due sorgenti: l'insieme delle segnalazioni e il registro delle
esecuzioni delle routine. Lo stesso errore è tornato quattro volte in venti
giri di verifica, ogni volta da una porta diversa:

- giro 1, la scheda scriveva «0 ricevuti, 0 lavorati, 0 prober lanciati» mentre
  la lista delle segnalazioni non si era caricata;
- giro 3, la tessera «Prober lanciati» scriveva 0 e sotto «0 esecuzioni in
  tutto» col registro irraggiungibile, mentre le due tessere accanto, davanti
  allo stesso guasto, scrivevano un trattino;
- giro 4, la riga «Riaperture chieste» scriveva zero sempre, perché leggeva
  come numero una cosa che numero non era;
- giro 20, dopo il ridisegno della scheda, di nuovo: registro non letto e tre
  zeri grandi, più tre righe di esito a zero e la torta che affermava «nessun
  lavoro verificato in questa finestra».

Ogni volta l'owner leggeva «questa settimana non è arrivato niente», che è il
contrario di quello che era successo. Uno zero è un dato: si crede.

## Come si applica

Il posto giusto per la distinzione è il modulo che fa i conti, non chi disegna.
Se la decisione sta nel renderer, il renderer successivo la rifà da capo: è
proprio quello che è successo fra il giro 3 e il giro 20, dove il ridisegno
della scheda ha riportato gli zeri.

In `src/shared/feedbackStats.js` il conto riceve `registroLetto` e, quando è
falso, riparte da zero voci e fa uscire `null` da ogni numero che veniva da
quella sorgente, id compresi. In pagina, `fsNum()` traduce `null` in `—`, e i
riquadri interessati lo scrivono anche a parole nel sottotitolo.

Due cose da non confondere:

- **letto e vuoto** è un dato: quello è uno zero vero, e si scrive 0;
- **non letto** non è un dato: trattino.

E una terza, che è la stessa regola vista dall'altra parte: una sezione intera
che non ha guardato niente non conclude. «Nessun lavoro verificato in questa
finestra» è un'affermazione sui dati; senza i dati si scrive che non si sono
letti.

## Sentinelle

`tests/unit/feedbackStats.test.mjs` («registro non letto: i numeri che ne
vengono sono null, non zero», e il suo gemello sul registro letto e vuoto) e
`tests/manage-statistiche-feedback.spec.mjs` («col registro irraggiungibile i
suoi riquadri scrivono un trattino, non uno zero»).
