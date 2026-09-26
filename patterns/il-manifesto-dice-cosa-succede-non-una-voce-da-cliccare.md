# Il manifesto dice cosa succede, non una voce da cliccare

[← Tutti i pattern](../PATTERNS.md)

Il manifesto delle capacità (`src/shared/capabilities.js`) è quello che Filo
sa di sé: l'assistente ci legge dentro per rispondere a «come faccio a…».
Quando una voce del manifesto promette un clic che non esiste, l'utente prova,
non trova niente, e conclude che Filo non sa fare quella cosa. Un manifesto che
mente è peggio di uno assente.

Il caso (#725). Il manifesto diceva «Clic destro su un link → "Spiega link"»,
e la voce «Spiega link» non è mai stata nel menu: la spiegazione è una sezione
che si riempie da sola all'apertura, senza niente da cliccare. Stessa cosa per
la spiegazione del testo selezionato, per quella di un'immagine, e per
«Traduci la pagina», che nel menu si chiama «Traduci».

Quello che teneva in piedi la bugia era una stringa: `menu_explain_link:
'Spiega link'` era rimasta in `i18n.js` senza che nessun codice la nominasse
più. Chi ha scritto il manifesto l'ha trovata lì e l'ha presa per una voce.

## La regola

**Se la cosa succede da sola, il manifesto lo scrive.** «La spiegazione arriva
da sola dentro il menu, non c'è una voce da cliccare» è un'istruzione che
funziona. Citare lo stesso un'etichetta perché suona meglio manda l'utente a
cercare.

**Un'etichetta che nessuno nomina non è una voce.** Quando togli una voce dal
menu, togli anche la sua chiave da `src/shared/i18n.js`. Finché resta lì
sembra viva, e il prossimo che scrive un testo per l'utente la copia.

**Il nome che scrivi è quello che l'utente legge.** «Traduci la pagina» era il
nome della funzione, non dell'etichetta: il manifesto deve citare la seconda.

## Dove

`src/shared/capabilities.js` per le voci, `src/shared/i18n.js` per le
etichette, `src/content/menuIcons.js` e `src/content/content.js` per quello che
il menu costruisce davvero.

Sentinelle in `tests/unit/capabilities.test.mjs`: una incrocia ogni voce che il
manifesto promette per il tasto destro con le etichette che il menu mostra
davvero, l'altra tiene insieme le tre spiegazioni inline e la loro descrizione.
La sentinella più vecchia, quella delle icone ritirate (#252), non bastava:
guardava solo le icone, e «Spiega link» non era un'icona.

**Una voce si nomina fra virgolette, sempre.** Il manifesto la introduce in tre
modi — la freccia, «scegli», l'elenco dopo «menu:» — e la sentinella riconosce
tutti e tre, ma solo su testo fra virgolette: un elenco scritto in prosa non lo
controlla nessuno. Le etichette le cerca fra i content script E fra le pagine
`filo://`, che hanno un menu loro.
