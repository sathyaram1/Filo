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

## Il secondo giro: il campo accanto

Il confronto per chiave chiudeva la porta solo quando l'altro campo stava in un
gruppo diverso. Le impostazioni però sono annidate, e i pezzi che si aprono a
vicenda stanno spesso nello stesso gruppo: modalità terminale e shell; le due
chiavi API; velocità, tono e voce della lettura; il rilevamento dei siti
pericolosi e le sue sotto-opzioni; la modalità dei cookie e i siti fidati. Un
confronto fermo al gruppo vede «il gruppo è cambiato» e rimanda anche il
fratello, col valore vecchio. Cinque porte, tutte con lo stesso finale del giro
prima: cambi la shell e il permesso della shell torna acceso; finisci di
scrivere la chiave di ricerca e la chiave che paga torna quella di prima.

Quindi il confronto scende fino alla foglia (`SN_STORAGE.partialCambiato`), con
un'eccezione dichiarata: le mappe il cui contratto è «questa è la lista
completa, chi manca è stato rimosso» (`REPLACE_KEYS`) viaggiano intere, perché
mandarne un pezzo cancellerebbe il resto.

Il secondo pezzo del giro 3 è la rilettura. Saltarla quando il cursore sta in un
campo sembrava prudente, ma il cursore resta appiccicato all'ultimo controllo
toccato, anche mentre l'utente è in un'altra scheda a parlare con Filo: da lì in
poi la pagina mostrava per sempre valori che non erano più veri. Adesso si
rilegge sempre, e si rimette al suo posto solo il **testo che l'utente stava
scrivendo** (`SN_PAGE_BOOTSTRAP.ricaricaSenzaDisturbare`): spunte, tendine e
pulsanti non hanno niente in corso da salvare.

## Dove sta

- `src/shared/storage.js` — `partialCambiato`, il confronto fino alla foglia
- `src/shared/pageBootstrap.js` — `ricaricaSenzaDisturbare`
- `src/pages/preferences/preferences.js` — `raccogli`, `ribasa`, `persist`
- `src/pages/options/options.js` — stesse tre funzioni
- `src/pages/security/security.js` — stesse tre funzioni, più `saveCookies`
- `tests/impostazioni-pagina-aperta.spec.mjs` — le porte, più la controprova che
  quello che tocchi tu si salva ancora
- `tests/unit/settingsPartial.test.mjs` — il confronto fino alla foglia, senza
  Electron
