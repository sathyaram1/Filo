# Un cancello che ti fa solo CONTROLLARE si può solo negare

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Quando un cancello ha due porte — «chiedi il permesso» e «controlla
cosa è già stato deciso» — non dare per scontato che chi ti interroga passi
sempre dalla prima. Per qualcuno il sistema fa solo il controllo, e allora il
default diventa una risposta definitiva: la domanda non compare mai, nessuna
scelta viene registrata, e siccome le pagine dove si cambiano le scelte
elencano solo quelle già prese, non resta nessun posto in cui rimediare. Si può
solo negare, mai consentire. Per quei casi la domanda la fa partire il
CONTROLLO, che intanto risponde col default.

**Come si riconosce.** Cerca il difetto in questa forma: «funziona tutto, solo
che X non arriva mai, e non compare nessun errore». Un cancello che nega in
silenzio è indistinguibile da una funzione rotta, e chi lo subisce non ha
nemmeno l'appiglio di una scelta sbagliata da correggere. La domanda da farsi è
sempre la stessa: *quali richieste arrivano solo dal controllo, e cosa succede
a chi le fa?*

## Il caso che l'ha fatta nascere

I permessi che i siti chiedono (#586), quarto giro di verifica. Filo aveva
appena chiuso il buco vero: senza gestore Electron concedeva tutto, e un sito
qualunque accendeva webcam e microfono. Il gestore nuovo installava le due cose
che Electron offre, la richiesta e il controllo, e rispondeva no finché
l'utente non sceglieva.

Per l'elenco dei caratteri installati (Local Font Access: lo usano gli editor
grafici sul web per farti scegliere un font del tuo computer) Chromium la
richiesta non la fa **mai**. Chiama solo il controllo, e con un no consegna al
sito un elenco vuoto senza dire niente a nessuno. Misurato sulla stessa pagina:
con la risposta di Filo il sito riceveva zero caratteri, con una risposta che
diceva sì ne riceveva 87. Prima di quel lavoro arrivavano tutti.

Il danno non era l'elenco vuoto: era che non c'era **nessuna strada** per
ottenerlo. Niente pastiglia, quindi niente scelta registrata, quindi in
Impostazioni quel sito non compariva e non c'era niente da ribaltare.
L'invariante di Filo dice che quello che si può dare si deve poter togliere;
qui mancava il rovescio, che vale uguale.

## La correzione

Una lista dichiarata dei permessi che arrivano solo da quella porta
(`SOLO_CONTROLLO` in `src/shared/permessiSiti.js`), e nel gestore del controllo:
se per quell'origine non è stato deciso niente, si fa partire la domanda in
sottofondo e intanto si risponde no. Quando l'utente consente, il controllo
dopo dice sì e il sito, riprovando, ottiene la sua roba. La lista è corta e
dichiarata apposta: allargarla a caso significherebbe far comparire pastiglie
per ogni `navigator.permissions.query` che passa di lì.

Due vincoli che la sentinella (`tests/unit/permessiSiti.test.mjs`) tiene fermi:
ogni permesso in quella lista **non** è fra gli innocui (se lo fosse non ci
sarebbe niente da chiedere) e **ha un nome in italiano**, o la domanda che
adesso compare non si capirebbe.

## Il vicino

[Un controllo che RIFIUTA non rifiuta mai in silenzio (e si può scavalcare)](un-controllo-che-rifiuta-non-rifiuta-mai-in-silenzio.md):
stessa famiglia, un gradino più in là. Là il rifiuto c'è ma non si vede; qui non
esiste proprio il momento in cui qualcuno avrebbe potuto dire di sì.
