# Sapere chi ascolta un evento senza darlo alla pagina

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Per sapere se una pagina ha un suo modo di gestire un gesto (il suo
menu del tasto destro) non le si dà il gesto: lo si chiede a una sonda che gira nel
mondo della pagina prima dei suoi script e segna chi si iscrive all'evento. La
sonda risponde a eventi dal nome segreto, sul nodo del cammino; non conta chi
ascolta tutto (la radice di React senza un `onContextMenu` sul cammino, lo stesso
ascoltatore su finestra o documento per tanti tipi di evento), e chi ha ascoltato
senza mostrare niente smette di contare. La sostituta di `addEventListener` deve
sembrare nativa a chi la ispeziona, come quelle della guardia anti-fingerprint.

**Il caso.** #975: «Menu di Google Docs» in cima al menu di Filo. Dare il tasto
destro alla pagina per vedere se lo annulla avrebbe aperto il suo menu insieme a
quello di Filo, e il sito non deve vedere quel clic (#589.4). Il clic si rigioca
alla pagina solo quando l'utente sceglie la voce; lì si vede se lo annulla e se un
menu compare vicino al cursore. Una pagina che lo annulla e basta (i siti che
bloccano il tasto destro) apre il menu del browser, e la voce lì non torna.

**Nelle prove.** Gli strumenti di Playwright, appena una prova legge la pagina,
mettono sulla finestra un ascoltatore solo per dodici eventi, `contextmenu`
compreso: senza la regola sull'ascoltatore generico ogni pagina di prova
sembrerebbe avere un menu suo.

**Dove vive.** `src/preload/menu-del-sito.js` (sonda e rigioco),
`tests/unit/menuDelSito.test.mjs`, `tests/menu-del-sito.spec.mjs`. Vicino:
[Un pezzo di Filo dentro un sito ubbidisce solo all'utente](un-pezzo-di-filo-in-un-sito-ubbidisce-solo-all-utente.md).
