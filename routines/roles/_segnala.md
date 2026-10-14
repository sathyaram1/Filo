## Una scelta che spetta all'owner: una domanda

Velocità contro costo, semplicità contro potenza, dati dell'utente, una scelta
di gusto: decide l'owner, e glielo chiedi con una domanda. Quando chiedere,
cosa ci va e dove stanno le note per chi riprende: CLAUDE.md § Domande
all'owner.

```bash
node scripts/domanda.mjs chiedi -   # il JSON da stdin, o da un file fuori dal repo
```

Un'opzione che fa ripartire questo lavoro con la scelta dell'owner ha l'azione
`riprendi` sul feedback del giro (`payload.id`). Un rifiuto sulla forma si
corregge e si riprova; se la domanda non parte per altro, la scrivi intera nel
file di `--segnala` se c'è, se no nel report.

Se la domanda non deve fermare il lavoro, consegni come sempre. **Se deve
fermarlo** (priorità `bloccante`), la consegna porta anche `--segnala
<file.md>`, un file scritto **fuori dal repo** (per esempio
`../segnala-<numero>.md`) che l'owner apre dal rombo nella scheda. Lo legge chi
non conosce il codice: il numero della domanda, la strada che hai preso per
consegnare e cosa cambia se l'owner sceglie l'altra.

**Una segnalazione FERMA il lavoro.** Il feedback torna fra i ricevuti
dell'owner e non riparte finché lui non ha risposto; poi riprende da dove era,
con la sua risposta davanti. Quindi ci va solo una scelta che spetta a lui: un
difetto lo correggi (o, se stai verificando, lo scrivi come rilievo col suo
livello), non lo segnali. Consegna comunque tutto quello che hai fatto: è da lì
che si riprende.

Una segnalazione per consegna: se ne hai due stanno nello stesso file.
