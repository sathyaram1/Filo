# Una promessa fatta all'utente non può dipendere dal modello

Il benvenuto scrive «se non ti va, scrivi "basta così" e chiudiamo». Quella
frase è un **contratto**, e affidarne l'esecuzione al modello significa non
averlo firmato: un modello piccolo si dimentica l'istruzione (è una fra molte) e
un modello irraggiungibile non risponde affatto. In #524 l'utente senza rete
restava chiuso dentro l'accoglienza, col solo "Riprova" davanti e sotto gli
occhi la frase che gli diceva di scrivere una cosa che non funzionava.

La regola: **ogni volta che un testo dell'app promette un comportamento
all'utente, quel comportamento deve avere una strada che non passa dall'LLM.**
Il modello resta la strada normale, più intelligente e più naturale; quella di
sotto è la rete di sicurezza.

- **Riconoscimento locale della parola chiave** (`SN_ONBOARDING.isStopRequest`):
  frase intera normalizzata (accenti, punteggiatura, riempitivi di cortesia)
  confrontata con un elenco chiuso. Volutamente **stretto**: la frase deve
  ESSERE un'uscita, non contenerne una. «basta che tu non sia prolisso» è una
  risposta all'intervista, e chiudere per sbaglio è il danno opposto. Il resto lo copre il
  modello.
- **E un controllo visibile**, per chi la frase non la ricorda o si trova
  davanti a una bolla d'errore: `#skipOnboarding`, sotto la conversazione, più
  la stessa uscita accanto al «Riprova» della bolla d'errore, che è il punto in
  cui l'utente si accorge di essere in trappola.
- **La chiusura non può dipendere dalla risposta**: il congedo è un testo fisso,
  e se la prima home non arriva (nessun modello) il client va alla home lo
  stesso dopo qualche secondo, invece di restare davanti a una chat chiusa.
