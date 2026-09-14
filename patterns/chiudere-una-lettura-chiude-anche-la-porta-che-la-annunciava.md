# Chiudere una lettura chiude anche la porta che la annunciava

[← Tutti i pattern](../PATTERNS.md)

Quando una superficie smette di essere per tutti, l'ingresso che ci portava non
smette da solo. Resta al suo posto, con la sua icona e la sua etichetta, e
adesso promette una cosa che non succede: si clicca, si apre una pagina vuota,
e sotto c'è scritto di accedere con un account che non si può ottenere. Chi
scrive la regola vede la regola; l'utente vede il menu.

Il caso (audit pre-alpha, #583). La lettura dei feedback è passata da pubblica
a «la vede chi li gestisce», ed era la cosa giusta da fare: fino a quel momento
un estraneo si portava via titolo, user agent, link agli screenshot e i
documenti vecchi in chiaro per intero. Ma la posta delle segnalazioni era
annunciata da **tre** strade, tutte lasciate com'erano: la voce «Feedback» nel
menu App della home, l'icona «Feedback» nel menu del tasto destro, il comando
`/feedback` nella chat. Per l'unica persona che poteva leggerla le tre strade
funzionavano; per tutti gli altri portavano a quattro schede vuote, una casella
di ricerca, un tasto «Riprova» che non poteva riuscire e due volte l'invito ad
accedere come amministratore. Amministratori non si diventa accedendo: l'elenco
sta nella console.

Il segnale c'era già, due funzioni più in alto nello stesso file: il menu
Impostazioni mostra «Modelli predefiniti» solo agli admin. **Due menu della
stessa shell che trattano due pagine dell'owner in modo diverso è la spia.**

## La regola

**Un permesso che si stringe si stringe fino al menu.** Cerca ogni posto che
nomina quella superficie — menu, icone, comandi in chat, scorciatoie, il
manifesto delle capacità, i testi di aiuto — e togli l'annuncio a chi non può
entrare. Non basta il primo che ti viene in mente: le porte erano tre, e ne
avevamo vista una.

**Chi ci arriva lo stesso legge una spiegazione, non un errore.** L'indirizzo si
può sempre digitare, e il link vecchio esiste ancora. «Errore nel caricamento»
manda a controllare la rete e a ripremere Aggiorna: due cose che non cambieranno
niente. Un permesso che manca si dice com'è.

**La strada che funziona va detta lì, nel momento in cui l'altra si chiude.**
Chi scrive `/feedback` non vuole leggere la posta dell'owner: vuole fare
qualcosa con i feedback. La risposta giusta non è «non puoi», è «per mandarne
uno: tasto destro → Invia feedback».

**Non chiudere per sbaglio la strada gemella.** Leggere i feedback è
dell'owner; *mandarne* uno è di tutti ed è anonimo per scelta. Sono due cose
diverse che si chiamano con la stessa parola, ed è così che un giro di
sicurezza spegne l'unico canale da cui arrivano le segnalazioni.

## Dove

`src/renderer/shell.js` (`buildApps()`, accanto a `buildSettings()` che lo
faceva già), `src/content/menuIcons.js` (l'icona entra nel registro solo se
`isOwner`: un id assente sparisce anche dai layout che l'utente si era salvato),
`src/pages/dashboard/dashboard.js` (il comando `/feedback` e l'elenco di
`/help`), `src/pages/manage/manage.js` e `src/pages/feedback/feedback.js` per la
frase che si legge arrivandoci per indirizzo.

Lo stato di owner si CHIEDE al main (`MSG.AUTH_STATUS`) e parte da «no»:
sbagliare per difetto costa un'icona a una persona, sbagliare per eccesso manda
tutti gli altri nel vicolo cieco.

Sentinella: `tests/unit/superficiSoloOwner.test.mjs` (le tre porte, più la
verifica che l'invio resti di tutti). Comportamento:
`tests/feedback-superfici-owner.spec.mjs`.
