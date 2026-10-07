# L'unità la dichiara chi ordina il conto, non il testo intorno

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando il codice deve formattare un valore prodotto da un modello,
l'unità (o il tipo: prezzo, data, percentuale) la DICHIARA chi ordina il
calcolo, dentro l'ordine stesso. Dedurla dalle parole che finiscono intorno al
risultato sembra funzionare sui casi che hai sotto gli occhi e non finisce mai:
la frase si può scrivere in troppi modi, e ogni giro ne chiude uno.

## Il caso

«Spiega il testo selezionato» converte gli importi in valuta. Il conto lo fa
Filo: il modello scrive un marker, `[[calc: 3000/109.3]]`, e il codice lo
sostituisce col numero. Un prezzo va scritto con due decimali — chi ha
segnalato leggeva «27,4473924977 €» — ma il marker diceva solo quanto fa, non
di che cosa.

Per sapere se quel numero era un prezzo il codice guardava il carattere
attaccato al marker. Da lì sono usciti tre giri:

1. la prima stesura riconosceva solo `€` incollato al numero;
2. il primo giro di verifica ha trovato il grassetto («`**27,45**` €»), le
   parentesi e la valuta scritta PRIMA del numero; la cura ha allargato lo
   sguardo agli orpelli di formattazione;
3. il secondo giro ha trovato le parole: «circa 27,4473924977 **in** euro»,
   «27,4473924977, cioè meno di trenta euro», l'importo in una casella di
   tabella e l'euro in quella accanto.

Tre giri, tre elenchi di modi di scrivere, e il quarto era già lì: «eur»
minuscolo, «euri», una virgola, una riga a capo.

## La cura

Il marker porta l'unità: `[[calc: 3000/109.3 | eur]]`. Il prompt la chiede
sempre, e a quel punto la frase attorno può essere scritta come capita.

Il vicinato del numero non è stato tolto: resta come **ripiego** per il modello
che l'unità non la dichiara, e può solo aggiungere un prezzo, mai toglierne
uno. Un ripiego che migliora e non può peggiorare non ha bisogno di essere
esatto.

Due effetti collaterali gratis:

- in streaming non c'è più niente da aspettare. Prima, finché dietro al marker
  non arrivava il `€`, il numero veniva nascosto con «…» per non farlo
  sfarfallare da dodici cifre a due sotto gli occhi di chi legge; con l'unità
  dichiarata il numero giusto si può scrivere subito;
- la prova sta negli unit test, sul testo che il modello potrebbe scrivere, e
  non serve aprire Filo per aggiungere un modo di scrivere la frase.

## Dove

- Marker e formato: `src/shared/calcMarkers.js`, sentinelle in
  `tests/unit/calcMarkers.test.mjs`.
- Il prompt che l'unità la chiede: `src/shared/constants.js` (`explain`,
  `explainDeep`), sentinella in `tests/unit/fxPromptLine.test.mjs` — il
  meccanismo senza il prompt che lo usa è codice morto.
