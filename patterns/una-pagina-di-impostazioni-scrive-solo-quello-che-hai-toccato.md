# Una pagina di impostazioni scrive solo quello che hai toccato lì

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Una pagina che salva da sola manda al salvataggio soltanto i valori
che l'utente ha cambiato su quella pagina, mai l'intero blocco letto
all'apertura, e il confronto scende fino alla **singola manopola**, non si ferma
al gruppo che la contiene. Finché resta aperta si rilegge quando l'impostazione
cambia altrove, così non mostra un valore che non è più vero.

## Il caso

Preferenze, Opzioni e Sicurezza non hanno un pulsante «Salva»: ogni tocco fa
partire il salvataggio. Ognuna delle tre costruiva l'oggetto intero dai propri
controlli e lo mandava tutto, a ogni tocco. Finché la pagina era l'unica a
scrivere, funzionava.

In Filo però la strada normale per cambiare un'impostazione è chiederlo, e le
schede restano aperte. Quindi succedeva questo:

1. apri le Preferenze e accendi la modalità terminale, il permesso che dà a Filo
   la shell;
2. ci ripensi e la spegni dicendolo a Filo, che apre il riquadro di conferma e
   aspetta il tuo sì;
3. torni sulla pagina Preferenze, ancora aperta, e cambi il tema.

La modalità terminale si riaccendeva. Nessuna conferma, nessun avviso: la pagina
aveva rimandato la spunta che si era letta all'apertura. La conferma che l'aveva
spenta non era servita a niente, e a riaprire il permesso bastava una scheda
lasciata aperta.

La stessa porta esisteva sulla pagina Opzioni con la chiave OpenRouter (un
segreto: tornare a quella di prima vuol dire spendere sul conto sbagliato), su
Sicurezza con le protezioni, e sullo stile dell'agente, cioè proprio la cosa che
il feedback #592 chiedeva di rendere «sempre visibile e cancellabile dalle
preferenze».

## Come si fa

Ogni pagina tiene il **punto di partenza**: quello che ha letto all'apertura, e
poi quello che ha scritto per ultimo. Al salvataggio confronta i controlli con
quel punto e manda solo le chiavi diverse. Le altre non le nomina nemmeno, e il
merge del salvataggio le lascia dov'erano.

Due dettagli che al primo giro mancavano e si vedono solo provando:

- **Un profilo nuovo non ha ancora niente scritto in memoria.** Un campo rimesso
  a mano sul proprio predefinito (una durata fuori scala che si riallinea a 5)
  risulterebbe «invariato» e non verrebbe salvato mai. Quindi una chiave che
  nella memoria non c'è proprio si manda comunque: scriverla non può disfare la
  scelta di nessuno, perché nessuno l'ha ancora fatta.
- **L'annuncio del cambiamento torna indietro anche a chi l'ha causato.** Se la
  pagina si rilegge su quell'eco, cancella l'avviso che ha appena mostrato (le
  righe scartate della blacklist dei siti). L'eco del proprio salvataggio si
  salta, per un attimo dopo aver scritto.

E la rilettura si fa solo se l'utente non sta scrivendo in un campo: altrimenti
si ferma lì. Il confronto in scrittura basta già a non disfare niente, e
riscrivere un campo sotto le dita è peggio del valore vecchio a schermo.

## Dove sta

- `src/pages/preferences/preferences.js` — `raccogli`, `ribasa`, `persist`
- `src/pages/options/options.js` — stesse tre funzioni
- `src/pages/security/security.js` — stesse tre funzioni
- `tests/impostazioni-pagina-aperta.spec.mjs` — le tre porte, più la controprova
  che quello che tocchi tu si salva ancora
