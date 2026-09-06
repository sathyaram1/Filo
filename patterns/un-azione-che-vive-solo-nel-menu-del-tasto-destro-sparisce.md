# Un'azione che vive solo nel menu del tasto destro sparisce col contesto

[← Tutti i pattern](../PATTERNS.md)

**La regola.** Se un'azione agisce su dati che Filo CONSERVA — non sull'elemento
che hai davanti in questo istante — il menu del tasto destro non basta come
unica porta: ci vuole anche un posto fisso in una pagina. Il menu contestuale
richiede un contesto, e quel contesto può mancare proprio nel momento in cui
l'azione serve.

**Il caso (#256).** La cronologia degli appunti si apre dalla freccia accanto a
«Incolla», e «Incolla» compare solo se il tasto destro cade dentro un campo di
testo. Rimuovere una voce e svuotare la cronologia erano lì dentro, e solo lì.
Ma il momento in cui uno vuole togliere una voce è quello in cui si accorge di
aver copiato una password — e lo si scopre quasi sempre leggendo una pagina
qualunque, dove un campo di testo non c'è. Il dato esisteva, la funzione
esisteva, e restavano irraggiungibili: la segnalazione infatti diceva «cerco in
Preferenze un modo per svuotarla e non lo trovo».

Il primo giro aveva letto il sintomo alla lettera (mancano il «×» e «Svuota
cronologia») e li aveva messi nel sotto-menu. Giusto, ma metà: chi ha il campo
di testo sotto il cursore è servito, chi non ce l'ha no. La porta fissa è
arrivata dopo, in Impostazioni → Sicurezza («Cronologia appunti»), con le stesse
due azioni.

**Come si riconosce prima.** Chiediti su cosa agisce l'azione. Se agisce
sull'elemento cliccato (copia questo link, scarica questa immagine), il menu è
casa sua e basta. Se agisce su una lista che Filo tiene da parte fra una sessione
e l'altra — cronologia, memorie, pagine salvate, file — allora il menu è una
scorciatoia, e la scorciatoia da sola non è un ingresso. Vale a maggior ragione
per le azioni di privacy: le si cerca in un momento di allarme, e in quel momento
si va a cercarle in Impostazioni, non si prova a indovinare quale menu le nasconde.

**La porta fissa non è solo «svuota tutto».** Se la duplichi a metà rifai il
danno: la segnalazione del #256 nasceva proprio dal dover perdere tutta la
cronologia per togliere una voce. La pagina mostra le voci una per una, ognuna
col suo «Rimuovi», e lo svuotamento in fondo — le stesse due azioni del menu,
con le stesse parole, perché è la stessa cosa fatta da un'altra porta. È la
faccia «raggiungibilità» di
[Se Filo sa CREARE una cosa, deve saperla anche togliere e cambiare](se-filo-sa-creare-una-cosa-deve-saperla-anche-togliere.md):
lì la domanda è se l'azione inversa esiste, qui se si riesce ad arrivarci.

**La porta fissa deve stare al passo, e in Filo «quando la scheda torna
davanti» non esiste.** La lista si ridisegnava dalla risposta del main dopo ogni
rimozione, e per il resto contava su `visibilitychange`. Quell'evento non arriva
mai: cambiando scheda Filo lascia le pagine in secondo piano "visibili" (larghe
zero, così un brano aperto in sottofondo continua a suonare), quindi la pagina
non si spegne e non si riaccende. Una scheda lasciata aperta sulla sicurezza
restava ferma a com'era all'apertura: copiavi una password in un'altra scheda,
tornavi lì e non c'era, cioè la pagina della privacy diceva meno del vero. La
cura è l'avviso dal main: ogni scrittura della cronologia appunti manda
`CLIPBOARD_HISTORY_UPDATED` alle sole pagine `filo://` (senza le voci dentro:
chi lo riceve rilegge), e la pagina si ridisegna. Vale per qualunque pagina
fissa che mostri dati che cambiano altrove: si aggiorna su un avviso, non su un
evento di visibilità che qui non scatta.

**Dove vive.** La sezione sta in `src/pages/security/security.html` +
`security.js` (`loadClipboard`/`renderClipboard`/`clearClipboard`); il sotto-menu
gemello in `src/content/menu.js` (`openSubmenu`). La lista viene sempre da quella
che risponde il main — dopo ogni rimozione si ridisegna con gli `items` della
risposta — così le due viste non possono raccontare cronologie diverse. Gli spec:
`tests/clipboard-history-page.spec.mjs` (la pagina) e
`tests/clipboard-history-remove.spec.mjs` (il menu).
