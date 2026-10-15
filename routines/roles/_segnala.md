## Un trade-off vero non lo decidi tu: lo segnali

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner. Scrivi un file markdown **fuori dal repo** (per
esempio `../segnala-<numero>.md`) e passalo alla consegna con
`--segnala <file.md> --livello <0-3>`, più `--difficile` se la scelta è
difficile da disfare (dati degli utenti, sicurezza, formati salvati su disco):
l'owner lo apre dal rombo nella scheda. Il livello è quello del problema, col
metro dei rilievi. Lo legge chi non
conosce il codice di questo progetto: breve, niente nomi di file o funzioni,
tre parti.

```markdown
## Problema
Due o tre righe: cosa hai incontrato e perché non spetta a te deciderlo.

## Scelte
- **A.** Cosa succede, e cosa costa.
- **B.** Idem.

## Cosa ho fatto nel frattempo
La scelta che consigli e che hai applicato per consegnare, e cosa cambia se
l'owner sceglie l'altra.
```

**Una segnalazione di livello 3, o con `--difficile`, FERMA il lavoro.** Il
feedback torna fra i ricevuti dell'owner e non riparte finché lui non ha
risposto; poi riprende da dove era, con la sua risposta davanti. Con 2, 1 o 0
il lavoro va avanti con la scelta che hai applicato, e la segnalazione diventa
un feedback derivato con la domanda: se l'owner sceglie diversamente, sarà quel
feedback a cambiare il codice già fuso. In ogni caso ci va solo una scelta che
spetta a lui: un difetto lo correggi (o, se stai verificando, lo scrivi come
rilievo col suo livello), non lo segnali. Consegna comunque tutto quello che
hai fatto: è da lì che si riprende.

Una segnalazione per consegna: se ne hai due stanno nello stesso file.
