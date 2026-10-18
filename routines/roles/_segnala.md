## Un trade-off vero non lo decidi tu: lo segnali

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner. Scrivi un file markdown **fuori dal repo** (per
esempio `../segnala-<numero>.md`) e passalo alla consegna con
`--segnala <file.md>`: l'owner lo apre dal rombo nella scheda. Lo legge chi non
conosce il codice di questo progetto: breve, niente nomi di file o funzioni,
tre parti.

```markdown
## Problema
Due o tre righe: cosa hai incontrato e perché non spetta a te deciderlo.

## Scelte
- **A.** Cosa succede, e cosa costa.
- **B.** Idem.

## Cosa ho fatto nel frattempo
La strada che hai preso per consegnare, e cosa cambia se l'owner sceglie l'altra.
```

Con il file passi il **livello del problema** (`--livello <0-3>`, il metro dei
rilievi) e, se la scelta è **difficile da disfare** (dati degli utenti,
sicurezza, formati salvati su disco), `--irreversibile`.

**Ferma il lavoro solo un 3 o una scelta difficile da disfare.** Il feedback
torna fra i ricevuti dell'owner e non riparte finché lui non ha risposto; poi
riprende da dove era, con la sua risposta davanti. **Con le altre il lavoro va
avanti**: applichi la scelta che consigli (è «Cosa ho fatto nel frattempo») e
la segnalazione esce in un feedback derivato con la domanda; se l'owner sceglie
diversamente, sarà quel feedback a cambiare il codice già fuso. In tutti e due
i casi ci va solo una scelta che spetta a lui: un difetto lo correggi (o, se
stai verificando, lo scrivi come rilievo col suo livello), non lo segnali.
Consegna comunque tutto quello che hai fatto: è da lì che si riprende.

Una segnalazione per consegna: se ne hai due stanno nello stesso file.
