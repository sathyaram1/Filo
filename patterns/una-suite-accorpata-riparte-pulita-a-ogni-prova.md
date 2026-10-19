# Una suite accorpata riparte pulita a ogni prova

[← Tutti i pattern](../PATTERNS.md)

Le prove di un'area stanno in un file con una sola app, `appCondivisa()` da `tests/helpers/appCondivisa.mjs`, che
prima di ogni prova riporta l'app com'era appena aperta. Il corpo delle prove resta quello di prima. Una prova che
dipende da qualcosa che l'azzeramento non tocca resta in un file suo.

## Perché

Ogni avvio di Electron costa secondi, e la suite ne faceva uno per prova (#238). Una prova scritta per un'app nuova
presume l'app nuova: una scheda sola, le impostazioni predefinite, l'archivio vuoto, le funzioni del main com'erano.
Se la trova sporca può fallire per colpa della prova prima. Oppure, peggio, passa senza provare niente: un valore
rimasto dalla prova prima soddisfa l'attesa.

Quanto vale: nel contenitore delle routine un lancio con la sua chiusura costa da due a dieci secondi, l'azzeramento
meno di uno. I 75 casi dei primi quattro file accorpati così sono passati da 7,3 a 6,3 minuti; dove Electron parte
più lento il guadagno cresce.

## Cosa si azzera

Prima di ogni prova, dalla seconda in poi:

- **schede**: si chiudono tutte, aspettando che le caselle in sospeso abbiano spedito. Si chiudono anche le finestre
  in più e la barra laterale, e alla fine c'è una home nuova, nata dopo l'azzeramento dello storage;
- **storage**: torna com'era a lancio fermo, con l'archivio delle schede, la cronologia e le segnalazioni. Non passa
  dal registro dei cambi, e le impostazioni si rimandano ai servizi che le tengono in memoria (`applySettingsUpdate`);
- **rattoppi del main**: tornano le funzioni globali e i metodi degli oggetti `SN_*` e `__filo*` cambiati da una
  prova, e spariscono i globali `__x` che le prove aggiungono (l'app ne crea solo coi nomi `__filo*`);
- **contesto di Playwright**: si tolgono gli script di `app.context().addInitScript` e le `route`;
- **avvisi della shell**: si chiudono.

## Cosa non si azzera

Una prova che dipende da una di queste cose resta in un file suo, oppure se ne occupa da sé:

- il filo (conversazioni e visite, `SN_IL_FILO`), che cresce solo in coda;
- le cache dentro i moduli del main, come il listino dei prezzi di `costoModelli.js`. Per questo
  `options-stima-costo-modelli` è rimasto fuori da `options`;
- i dati di sessione di Chromium (cookie, `localStorage` delle pagine);
- gli ascoltatori aggiunti dal main ad `app`, `ipcMain` o alla sessione.

## Come si accorpa

- `const { test, expect } = appCondivisa();` prende il posto dell'import dalla fixture. Ogni file di prima diventa un
  `test.describe('<nome>')` col corpo intatto, e helper e costanti restano dentro il suo describe.
- Niente `mode: 'serial'`. Una prova rossa fa ripartire il worker con un'app nuova: le altre girano lo stesso, e il
  nuovo tentativo della rossa parte da un'app nuova come prima.
- Le opzioni di lancio (`test.use({ accoglienzaFatta: false })` e le altre) non si possono cambiare a metà file. La
  fixture `app` sovrascritta si ferma dicendolo: l'opzione si passa ad `appCondivisa({ … })`, o la prova resta in
  un file suo.
- Con `FILO_APP_CONDIVISA_DEBUG=1` si vede cosa l'azzeramento ha rimesso a posto. Ogni nome deve essere un rattoppo
  di una prova: uno dell'app vorrebbe dire che l'azzeramento le disfa il lavoro.
- Il file accorpato si prova due volte, nell'ordine scritto e coi describe in ordine inverso.

## Dove vive

- `tests/helpers/appCondivisa.mjs`: lancio, azzeramento, chiusura;
- `tests/app-condivisa.spec.mjs`: sporca tutto quello che l'azzeramento sa togliere e controlla che sia tornato;
- `tests/unit/appCondivisa.test.mjs`: il lancio resta uguale a quello della fixture, che non si tocca.

Sono accorpati così `options`, `spellcheck`, `dashboard` e `tab-archive`. I primi accorpati (`dashboard-command`,
`editor-*`, `tab-colors`, `tab-bar-layout`, `account-menu`) lanciano Electron per conto loro, in modalità seriale e
senza questo azzeramento.
