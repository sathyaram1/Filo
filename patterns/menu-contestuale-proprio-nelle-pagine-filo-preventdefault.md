# Menu contestuale proprio nelle pagine filo://: `preventDefault` e il menu di Filo si fa da parte

[← Tutti i pattern](../PATTERNS.md)

Una pagina interna può avere un **menu contestuale proprio** su certi elementi
(chip dell'archivio, card dei mazzi): l'handler `contextmenu` dell'elemento
chiama `e.preventDefault()` e apre il suo popup (classi `.sn-select-pop`/
`.sn-select-option`, posizionato `fixed` alle coordinate del click). Il menu
generale di Filo, sulle pagine filo://, ascolta in **bubble** su window e cede
il passo se `e.defaultPrevented` è già vero.

- **Perché:** sulle pagine web ESTERNE Filo intercetta il tasto destro in
  capture aggressiva (deve battere gli handler di siti ostili come YouTube);
  sulle pagine INTERNE gli handler sono nostri e più specifici → vince la
  pagina, il menu di Filo è il fallback sul resto della superficie.
- **Regola operativa:** in una pagina filo:// basta `preventDefault()`
  nell'handler dell'elemento; NON serve `stopPropagation`. Se non chiami
  `preventDefault`, il tasto destro apre il normale menu di Filo.
- **Un ascoltatore per la superficie, non uno per elemento.** Dove il contenuto
  si ridisegna a ogni giro (righe, fette, barrette) agganciare il menu elemento
  per elemento vuol dire riagganciarlo ogni volta: l'ascoltatore sta sul
  pannello e una funzione sola decide, dal punto premuto, quali voci offrire.
  Se per quel punto non ce n'è nessuna NON si chiama `preventDefault`, e resta
  il menu generale di Filo: un popup vuoto è peggio del ripiego.
- **Su un disegno il ripiego non c'è: o il menu lo dai tu, o non esce niente.**
  Il menu generale di Filo non arriva sugli elementi di un SVG, quindi il tasto
  destro su una fetta di torta o su una barretta di grafico non apriva proprio
  nulla, mentre due centimetri più in là (una riga di testo) apriva il menu
  generale: la stessa scheda rispondeva in due modi. Vale anche per il VUOTO
  del disegno, gli angoli del quadrato fuori dal cerchio: si aggancia il
  contenitore del grafico, non solo le sue fette.
- **Dove:** registrazione in `src/content/content.js` (ramo pagine interne);
  esempi in `src/pages/archive/archive.js`, `src/pages/decks/decks.js` e la
  scheda «Statistiche feedback» di `src/pages/manage/manage.js`
  (`stVociMenu`/`openCtxMenu`, lo stesso popup del menu di ordinamento della
  lista: due copie della stessa apertura divergono al primo ritocco).
