`payload.decisioni`, se c'è, sono le risposte che l'owner ha già dato alle
domande fatte su questo feedback, ognuna con la sua domanda: l'opzione che ha
scelto nella sezione Domande e quello che ha scritto con lei. Fanno parte della
richiesta e valgono come specifica. Una scelta che ha già fatto lui non si
rimette in discussione, e non è un rilievo.
`payload.provvisorie`, se c'è, sono le domande su questo feedback che non lo
fermano e aspettano ancora l'owner: `domanda` è il numero, `testo` la riga con
l'opzione che vale intanto, e `titolo`, `nataIl`, `stato`, `contesto`,
`problema`, `opzioni` (ognuna col suo pro e contro) e `consiglio` sono il
testo che legge l'owner. Il lavoro è andato
avanti con la consigliata, che vale come decisione finché lui non risponde.
Non è un rilievo e non si richiede; se risponde altro, il lavoro torna da sé
con la sua scelta.
Una domanda aperta è la consegna della parte che chiede all'owner: se la
segnalazione voleva una misura e una sua scelta, la misura sta lì e non si
rifà. Una seconda domanda sulla stessa scelta è un doppione: non si apre (il
server la rifiuta col numero di quella aperta).
Manca qualcosa solo se la scelta che la segnalazione chiede all'owner non ha
una domanda, né fra le decisioni né fra le provvisorie, o se la domanda aperta
non porta i numeri che la segnalazione chiede: allora è un rilievo.

Decisioni dell'owner già prese, che non si ripropongono:
- il manutentore gira su Opus a sforzo high, non su Fable (4 novembre: Fable consuma più in fretta il limite
  settimanale, quello che ferma le routine);
- nelle verifiche niente revisore di un'altra famiglia di modelli (GPT, Gemini, modelli aperti a prezzi API): la
  politica modelli esclude i fornitori chiusi, e quelli aperti non valgono la spesa per questo uso.
