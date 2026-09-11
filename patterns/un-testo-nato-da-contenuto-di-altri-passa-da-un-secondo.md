# Un testo nato da contenuto di altri passa da un secondo modello, e da un varco solo

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Qualsiasi testo che Filo mostra all'utente dopo aver letto roba
scritta da altri passa da UNA funzione sola, che applica prima i controlli
deterministici e poi un secondo modello — **diverso** da quello che il testo
l'ha scritto. Il varco è obbligatorio a runtime, non per buona volontà di chi
scrive la superficie nuova.

## Il caso che l'ha fatto nascere (#536)

La notifica è un canale di attacco. Una mail scritta bene non parla all'utente:
parla a Filo, e Filo la riscrive come «la tua banca chiede di confermare le
credenziali, apri qui». L'utente si fida di Filo, non del mittente. Nella
tabella dei livelli il testo verso l'utente è costo zero e passa sempre: è la
porta più larga che ci sia.

## Perché un SECONDO modello, e perché diverso

Due contesti sullo stesso modello condividono le stesse debolezze e cadono
insieme: se la mail ha convinto il modello che ha scritto il testo, convincerà
anche lo stesso modello che si rilegge. È molto difficile invece che una mail
inganni insieme due modelli con due compiti diversi.

Quindi l'indipendenza è una proprietà del CODICE, non della configurazione:
`SN_GUARDIANO.catenaGuardiano` toglie dalla catena del guardiano ogni nickname
usato da chi ha prodotto il testo, e se non resta niente il guardiano non gira —
e il testo non passa. Una sentinella negli unit test lo verifica sia sulla
funzione sia sulla configurazione di prova.

## I tre esiti, e il default che conta

`passa` è l'unico esito che mostra il testo, e lo produce solo una risposta
esplicita e ben formata. Tutto il resto — rete giù, fornitore fuori uso,
risposta fuori formato di un modello dirottato, nessun modello indipendente —
cade su `attesa`: l'avviso non compare e non si perde, resta in coda visibile e
riparte al giro dopo. Un avviso che arriva dieci minuti dopo non ha fatto danno;
uno che arriva senza controllo sì.

Il tentativo sbagliato da non rifare: far cadere l'errore su «passa» per non
perdere avvisi. Un guardiano che si apre quando si rompe non è un guardiano.

## Il varco è uno solo, e lo impone il runtime

`src/shared/filoMemory.js → addNotification` **rifiuta** una notifica di classe
contaminata che non porti il timbro del varco (`SN_GUARDIA.timbro()`, casuale a
ogni avvio, quindi non scrivibile a mano). Una superficie nuova che si
dimenticasse del guardiano si ferma lì invece di mostrare il testo. La
sentinella nei test aggiunge la seconda metà: chi scrive notifiche è in un
elenco, e mettersi in elenco vuol dire aver deciso la classe di fiducia.

## Perché i controlli statici vengono PRIMA

Codici usa e getta, codici di recupero, password, chiavi, coordinate bancarie,
segreti custoditi da Filo, collegamenti la cui destinazione non coincide con
quella promessa: qui non c'è un giudizio da chiedere, c'è una cosa vista. Sono
deterministici, girano a rete staccata e non costano niente — e soprattutto non
possono essere convinti.

## I blocchi devono restare rari

Un guardiano che grida al lupo viene spento, e a quel punto non protegge da
niente. Per questo: il blocco SPIEGA cosa ha visto (non «ho avuto un dubbio»),
finisce in un registro leggibile dall'utente (Impostazioni → Sicurezza), e il
tasso di falsi allarmi si misura su un banco di mail simulate
(`tests/fixtures/banco-guardiano.json`, `npm run banco:guardiano`) con una
sentinella sempre accesa negli unit test.

## Dove vive

- `src/shared/guardiano.js` — logica pura: classi di fiducia, controlli
  statici, prompt, verdetto, indipendenza del modello, destinazione vera dei
  collegamenti.
- `src/main/services/guardiaTesti.js` — il varco: modello, tentativi, coda,
  registro.
- `src/main/services/handlers.js` — la catena del guardiano (ripulita dal
  produttore) e il varco applicato alla risposta di una chat contaminata.
- `tests/unit/guardiano.test.mjs`, `tests/unit/guardiaTesti.test.mjs`,
  `tests/guardiano-notifiche.spec.mjs`, `tests/guardiano-chat.spec.mjs`.

Vicini: [Un mittente nuovo si classifica su DUE assi: da dove viene, e quanto ci si fida](un-mittente-nuovo-si-classifica-su-due-assi.md).
