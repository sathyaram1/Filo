# Un gesto che la pagina può fabbricare non è un gesto dell'utente

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Se una funzione di Filo si comporta diversamente perché «l'ha
chiesto l'utente», quel gesto va preso solo quando `isTrusted` è vero: la UI di
Filo dentro una pagina web vive nel DOM del sito, e il sito la apre e la preme
come vuole. I gesti che Filo si fabbrica da solo passano da
`SN_FILO_UI.premi(el)`, che li dichiara; il guardiano
(`SN_FILO_UI.guardiaGesti`, installato dal content script sulle sole pagine
http(s)) butta via tutti gli altri.

**Il caso.** #586 ha chiuso i permessi chiesti dai siti: fotocamera, microfono,
posizione, notifiche, appunti e schermo passano da una domanda. Due cose però
la domanda la saltano, ed è giusto che la saltino: l'Incolla e la dettatura del
menu del tasto destro, dove a chiedere gli appunti e il microfono è l'utente a
Filo e non il sito. Una pastiglia col nome del sito sarebbe una bugia, e un
«Nega» spegnerebbe l'Incolla di Filo su quel sito per sempre.

Il terzo giro di verifica ha aperto l'esenzione dall'altra parte. Poche righe in
una pagina qualunque, eseguite al caricamento:

```js
t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
// …600 ms dopo, il menu di Filo è lì, nel DOM del sito:
document.querySelector('.sn-menu-paste-main').click();
```

Il contenuto degli appunti finiva in un campo del sito, e il sito lo leggeva.
Nessun clic di nessuno, nessuna domanda, e in Impostazioni niente da revocare
perché nessuna scelta era stata presa. La stessa riga, premendo «Detta», apriva
il microfono: Filo cominciava ad ascoltare e scriveva la trascrizione nel campo
del sito.

**Perché `isTrusted` e non altro.** Il flag lo mette il browser e la pagina non
lo può falsificare: un evento creato con `new MouseEvent` o un `elemento.click()`
nasce con `isTrusted` falso, sempre. Un `Object.defineProperty` sull'evento non
serve a niente, perché il listener di Filo gira nel mondo isolato dei content
script, dove l'oggetto evento è un altro involucro e la proprietà letta è quella
vera.

Non basta invece guardare «c'è stato un gesto vero da poco»: su una pagina si
clicca in continuazione, e una finestra di qualche secondo la si aspetta. Deve
essere QUEL gesto, non un gesto qualsiasi vicino.

**Perché il registro e non l'attributo.** «Questo pezzo di pagina l'ho disegnato
io?» si chiede all'elenco di `SN_FILO_UI.mark()`, che vive nel mondo isolato:
l'attributo `data-sn-ui` se lo scrive addosso anche il sito. È la stessa
distinzione già scritta in `src/shared/filoUi.js` per #514, dove un sito si
marcava un elemento invisibile per tenere l'utente dentro allo schermo intero.

**Dove vive.** `src/shared/filoUi.js` (`nostra`, `premi`, `guardiaGesti`),
installato da `src/content/content.js`. Chi preme un proprio bottone per conto
di Filo lo dichiara: `src/content/menu.js` (il sotto-menu che si apre passandoci
sopra con qualcosa in mano), `src/content/feedback.js` (il selettore di file di
«Allega»), `src/shared/confirmUi.js` (l'aggancio dei test). Le prove stanno in
`tests/permessi-siti.spec.mjs`, e provano tutt'e due i lati: il gesto fabbricato
non passa, quello di una persona sì.

**Il vicino.** [Quello che il sistema aggancia da sé va DICHIARATO](quello-che-il-sistema-aggancia-da-se-va-dichiarato.md):
stessa forma, altro posto. Ciò che non dichiari resta com'era, e com'era non è
mai quello che volevi.
