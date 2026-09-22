# Un numero si apre su cosa ha contato

[← Tutti i pattern](../PATTERNS.md)

Una statistica dice **quante**. La domanda che arriva subito dopo, sempre, è
**quali**. Se la scheda non risponde, chi la guarda torna alla lista e ci cerca
a mano: il lavoro che la scheda doveva togliergli.

Quindi: ogni superficie che porta un numero si apre su ciò che ha contato. Col
clic, con Invio o Spazio se non è già un pulsante, e col tasto destro, che in
Filo è «voglio fare qualcosa qui». Vale per il numero grande di un riquadro,
per una riga di ripartizione, per una fetta di torta, per la sua voce di
legenda e per una colonna di un grafico. Dove dietro non c'è niente da aprire
(i lanci delle routine: un lancio non è una segnalazione) la superficie non
finge: niente puntatore a mano, niente voce nel menu.

## Il caso: quindici giri su una scheda di statistiche (#496)

La scheda «Statistiche feedback» della dashboard di gestione ha girato in
verifica sedici volte. In nove di quei giri il rilievo era questo, scritto con
parole diverse: «la riga dice 12 e cliccandola non succede niente»; «la fetta
non risponde al clic mentre la sua voce di legenda sì»; «il tasto destro su un
numero apre il menu generale della pagina, quello che esce anche sullo spazio
bianco».

Il difetto non era un bottone dimenticato: era che la regola non era scritta da
nessuna parte, quindi ogni superficie nuova nasceva muta e la verifica la
ritrovava una per giro.

## Come si fa, in pratica

I conti tornano già **gli identificativi** di ciò che hanno contato, non solo i
totali: `src/shared/feedbackStats.js` mette un `ids` accanto a ogni `n`. La
pagina non ricalcola niente, risolve l'elemento cliccato sull'ultimo conto
fatto (`fsSorgente` in `src/pages/manage/manage.js`) e apre un elenco.

Tre cose che l'elenco deve fare, e che sembrano dettagli finché non mancano:

- **portare alla cosa vera.** Una riga dell'elenco apre la segnalazione nella
  colonna di sinistra, nella sua sezione. Un elenco che si limita a nominarle
  lascia il lavoro a metà.
- **dire quando non può.** Le statistiche leggono l'INSIEME delle segnalazioni,
  la lista a sinistra le più recenti: una che sta nel primo e non nella seconda
  non si può aprire. La riga lo scrive ed è spenta, invece di non fare niente
  al clic.
- **chiudersi da sé quando il conto cambia.** Cambiata la finestra o il filtro,
  quei numeri non sono più quelli: l'elenco aperto su un conto vecchio direbbe
  una cosa che la scheda sopra non dice più.

## Quando i numeri sono due, si apre quello giusto

Un riquadro può portare due numeri: quello grande e la riga piccola sotto.
«Esplorazioni lanciate» scrive in grande quante volte è partita
l'esplorazione — partenze, che segnalazioni non sono — e in piccolo quante
segnalazioni quelle partenze hanno trovato. Finché ad aprirsi era il riquadro
intero, un numero che diceva cinque apriva un elenco di uno, e il tasto destro
sopra quel cinque offriva «Mostra la segnalazione contata».

La regola non cambia, cambia dove si applica: si apre la superficie che ha
contato QUELLE righe. Il numero grande resta muto (dietro non c'è niente da
aprire) e la riga piccola diventa un pulsante vero, con clic, Invio, Spazio e
tasto destro. Prima di collegare un elenco a un riquadro, chiediti quale dei
numeri che porta ha contato quelle righe.

## Due trappole di resa, tutte e due invisibili a un test sui numeri

**L'etichetta cercata nella tabella sbagliata.** La divisione per categoria
chiamava ogni riga «Stato ignoto». Il nome di uno stato sta in
`SN_FB_STATUS.STATUSES`; `CANONICAL` è l'elenco delle chiavi, cioè un array, e
cercarci dentro per nome torna sempre `undefined`. Gli unit test e gli spec
asserivano le CHIAVI delle righe, non i loro nomi, quindi erano verdi con otto
righe che si chiamavano tutte uguali. Se una lista ha un'etichetta per ogni
voce, il test deve chiedere che siano **diverse**.

**La barra proporzionale larga zero.** Le barrette erano uno `<span>` dentro un
altro, con `width: 72%` e `height: 100%`. Uno `<span>` resta in linea, e su un
elemento in linea né l'altezza né la larghezza in percentuale valgono: ogni
riga mostrava la stessa scanalatura vuota, e l'unica differenza fra un 7 e un 1
era la cifra in fondo. La regola generale: un riempimento proporzionale vuole
`display: block`, e la prova misura la larghezza vera
(`getBoundingClientRect().width`), non l'attributo di stile che le è stato
scritto sopra.

## Come si prova

In `tests/manage-statistiche-feedback.spec.mjs`: una riga della ripartizione,
una fetta, la sua voce di legenda e una colonna del grafico si aprono
sull'elenco giusto; il tasto destro offre «Mostra le segnalazioni contate» e
«Copia riga e numero»; dall'elenco si arriva alla segnalazione aperta nella sua
sezione.

Una fetta di ciambella si clicca **sulla fetta**, non al centro del suo
rettangolo: per un mezzo anello quel centro cade nel buco, e il clic non arriva
a niente. Lo spec prende un punto sull'arco esterno
(`getPointAtLength`) e lo tira dentro di una dozzina di pixel.
