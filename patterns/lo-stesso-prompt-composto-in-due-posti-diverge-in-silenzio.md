# Lo stesso prompt composto in due posti diverge in silenzio

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un prompt lo compone UN solo posto: quello che ha tutti i dati che
gli servono. Se due strade portano alla stessa risposta e ognuna se lo
costruisce, la strada senza i dati non fallisce: risponde lo stesso, a memoria
del modello, e nessuno se ne accorge.

## Il caso

«Spiega il testo selezionato» converte gli importi in valuta straniera. Il
cambio del giorno lo prende il processo principale da un servizio della BCE:
sta lì perché serve la rete e una cache, e nel content script non c'è.

Le strade per arrivare alla stessa spiegazione erano due:

- il menu del tasto destro manda al main il testo selezionato, e il main
  compone il prompt col cambio dentro;
- il riquadro (Alt+E, e la freccia «Approfondisci») si componeva il prompt da
  sé, nel content script, e mandava al main i messaggi già pronti.

Il main li usava così com'erano. Dal riquadro, quindi, il modello non ha MAI
visto un cambio: convertiva a memoria, con tassi vecchi di quanto sono vecchi i
suoi pesi, e scriveva un numero plausibile. Un numero plausibile non si
distingue da uno giusto guardando lo schermo, e la funzione sembrava funzionare.

Il test che sarebbe servito non c'era perché quello che c'era guardava il posto
sbagliato: una prova su `formatForPrompt` (la riga dei cambi si scrive bene) e
una sulla riga dei cambi come dato. Nessuna sul prompt che parte davvero. È
[Due estremi verdi non fanno un filo](due-estremi-verdi-non-fanno-un-filo.md)
visto dal lato di chi compone.

## Come si fa

- **Il prompt lo compone chi ha i dati.** Chi sta a monte manda il DATO GREZZO
  (il testo selezionato, la frase che lo conteneva), non un testo già montato.
  Così le strade equivalenti sono equivalenti per costruzione, e un dato nuovo
  nel prompt arriva a tutte insieme.
- **Se a monte serve comunque una copia** (la storia da cui ripartono le
  domande successive), chi compone gliela restituisce e quella copia si butta.
  Due copie che vivono in parallelo tornano a divergere.
- **La prova si scrive sul prompt che parte**: si intercetta il modello finto e
  si guarda il testo che ha ricevuto. Una prova sul pezzo che scrive la riga
  resta verde mentre la riga non parte.
