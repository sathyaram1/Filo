# Una parola che l'app riconosce da sé deve sapere A COSA l'utente sta rispondendo

[← Tutti i pattern](../PATTERNS.md)

La rete di sicurezza di
[Una promessa fatta all'utente non può dipendere dal modello](una-promessa-fatta-allutente-non-puo-dipendere-dal-modello.md)
ha un costo: l'app decide **senza capire**, e in una
conversazione lo stesso pugno di parole vuol dire cose diverse a seconda di
cosa è stato appena chiesto. Nell'accoglienza (#524) l'elenco delle uscite
conteneva «no grazie», «magari dopo», «non ora», «lascia stare», «passo» — cioè
esattamente i modi in cui in italiano si **declina una proposta**. E Filo, in
quell'intervista, propone: l'accesso Google, il tema scuro, un approfondimento
sui modelli. Chi rispondeva «no grazie» all'accesso si vedeva chiudere tutta
l'accoglienza: delle sei cose da scoprire e da dire ne aveva sentite due, e le
altre quattro non le avrebbe sentite più.

La regola: **un riconoscimento locale può coprire solo le frasi che significano
la stessa cosa in qualunque punto della conversazione.** Tutto ciò che dipende
da cosa è stato appena chiesto resta al modello, che quella domanda ce l'ha
davanti.

- **Due elenchi, non uno** (`SN_ONBOARDING`): `STOP_PHRASES` («basta così»,
  «salta», «stop», «chiudiamo») chiedono di uscire e non vogliono dire altro →
  chiude l'app, sempre, anche col modello muto. `DECLINE_PHRASES` («no grazie»,
  «magari dopo», «non ora») rifiutano *qualcosa*, e quel qualcosa lo dice la
  domanda a cui rispondono → le gestisce il modello.
- **La decisione sta in UNA funzione**, `isExitRequest(state, text)`, che guarda
  anche lo stato: se nella conversazione non c'è nessuna battuta di Filo, un
  rifiuto non può riferirsi ad altro che all'accoglienza e allora chiude.
- **Anche il prompt va corretto**, non solo il codice: il modello è la seconda
  porta da cui lo stesso danno rientra. `PROMPTS.filoChatOnboarding` distingue
  «chiudi l'accoglienza» da «no a questa proposta», con l'ordine esplicito di
  non chiudere nel secondo caso.
- **Il test giusto non è la frase, è la coppia domanda-risposta**: «no grazie»
  dopo una proposta di Filo (`tests/verify-524-g2.spec.mjs`,
  `tests/unit/onboarding.test.mjs`).
