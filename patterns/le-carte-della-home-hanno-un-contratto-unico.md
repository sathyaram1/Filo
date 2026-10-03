# Le carte della home hanno un contratto unico

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Ogni carta della home ha titolo, stato, un'azione principale, «apri nel filo» e un modo di
toglierla, e risponde al passaggio del puntatore e al tasto destro. A sinistra stanno le cose che
**accadono** (le spinge Filo e cambiano da sole: timer, sveglie, scaricamenti, avvisi, la carta dei Crediti
senza chiave); a destra quelle che l'utente **tiene** (le sceglie e le dispone lui). Una carta nuova entra
nel catalogo condiviso, non in un `if` della pagina.

## Perché

Nella home di prima la colonna sinistra erano i siti suggeriti, che cambiavano posto a ogni scheda e non si
usavano a memoria, e a destra stavano avvisi e timer insieme, senza distinguere quello che succede da quello
che si tiene (#870, dalla spec della home e del filo). La differenza fra i due lati è di **tempo**: a sinistra
l'ordine lo decide l'urgenza (prima quello che suona, poi quello che scorre, poi quello che è già successo),
a destra lo decide l'utente e resta dopo il riavvio. «Filo ti suggerisce» è una carta fra le altre, non la
colonna intera.

Ogni carta è anche una conversazione: «apri nel filo» riapre lo scambio che l'ha fatta nascere (il timer
ricorda la chat che l'ha chiesto) e, se non ce n'è uno, scrive nel filo una frase di Filo che entra nello
storico, così il modello sa di cosa si parla alla domanda dopo. Un pezzo di testo scelto da fuori (il nome di
un file scaricato) viaggia con la sua provenienza, come l'esito di un comando.

## Le scelte che reggono

- **Forma unica, una funzione sola.** `costruisci()` in `src/pages/dashboard/dashboard-carte.js` disegna
  tutte le carte dallo stesso oggetto (`titolo`, `stato`, `principale`, `secondaria`, `voci`, `filo`,
  `togli`); il menu del tasto destro nasce da quell'oggetto, quindi offre sempre le stesse azioni dei
  pulsanti più «Apri nel filo», «Sposta su/giù» e «Togli».
- **Si rifà solo quando cambia la forma.** Il conto alla rovescia riscrive il testo dello stato e basta: un
  clic che cade mentre il secondo scatta resta sul suo pulsante
  ([Un elenco che si aggiorna da solo non rifà i pulsanti](un-elenco-che-si-aggiorna-non-rifa-i-pulsanti.md)).
- **La disposizione la scrive il main, una mossa alla volta.** La pagina manda la mossa (`togli`,
  `aggiungi`, `sposta`, `ordina-sinistra`, `nascondi`), non la disposizione intera; il main le mette in fila
  (`src/main/services/carteHome.js`), perché due schede della home e la chat possono muovere nello stesso
  momento ([Chi rilegge tutto e riscrive tutto mette le scritture in fila](chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md)).
  La stessa mossa arriva dalla chat con l'azione `CARTA_HOME` («togli la carta dei mazzi»).
- **Tolta non vuol dire persa.** Una carta di destra tolta diventa un'icona in «altro», da cui si rimette
  col clic sul «+», col tasto destro o trascinandola nella colonna. Togliere una carta di sinistra toglie la
  cosa che racconta (il timer, l'avviso) o, se è solo un ricordo (uno scaricamento finito), la nasconde.
- **Una carta nuova si aggiunge al catalogo.** `CARTE` e `APP` in `src/shared/carteHome.js`: chi aveva
  già salvato una disposizione la ritrova in fondo a destra, perché tolte sono solo quelle tolte da lui.
  Colori e misure passano dai token `--dash-*`
  ([Estetica: ogni variabile visiva è un token del registro, mai un valore sparso](estetica-ogni-variabile-visiva-e-un-token-del-registro.md)).

Prove: `tests/unit/carteHome.test.mjs` (mosse e catalogo) e `tests/home-carte.spec.mjs` (la home vera).
