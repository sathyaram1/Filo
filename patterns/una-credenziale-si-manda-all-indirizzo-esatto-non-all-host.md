# Una credenziale si manda all'indirizzo esatto, non all'host

[← Tutti i pattern](../PATTERNS.md)

Un controllo sull'URL nasce quasi sempre per una domanda modesta: «posso fare
fetch qui?». Serve a non trasformare un canale in una fetch arbitraria, e per
quello l'host basta. Poi arriva il giorno in cui alla stessa risposta si
appende una seconda decisione: «e ci metto dentro le credenziali?». Quella
seconda decisione ha bisogno di un controllo molto più stretto, e il controllo
non è cresciuto insieme alla domanda.

Il caso (verifica #582, giro 1). Chiusa la lettura del deposito degli
allegati, la dashboard ha cominciato a firmare il download con l'identità
dell'owner, così le immagini si vedono anche quando il link salvato non porta
più il suo lasciapassare. Giusto. Solo che l'indirizzo dell'allegato non lo
sceglie l'owner: sta dentro il documento del feedback, e un feedback lo crea
chiunque senza login (le regole di Firestore validano `images` come lista di al
più cinque elementi, non il contenuto). Il controllo diceva «l'host è
`storage.googleapis.com` o `firebasestorage.googleapis.com`», quindi bastava
indicare un bucket qualunque ospitato da Google e la dashboard ci portava l'id
token dell'owner: la credenziale che vale su tutto il progetto per un'ora.

**La regola: prima di attaccare una credenziale a una richiesta, chiedi «chi ha
scritto questo indirizzo?».** Se la risposta è «un dato che arriva da fuori»,
il confronto va fatto sulla risorsa intera (host **e** percorso, cioè il bucket
per nome), non sul solo host. E il confronto si fa parsando l'URL, non con una
regex: `new URL` normalizza i casi in cui una regex si fa fregare (host in
maiuscolo, una chiocciola prima del vero host, `..` nel percorso), e un
indirizzo che non si parsa vale «no».

**Un guard che serve a due cose sta per diventarne uno solo sbagliato per
entrambe.** Qui la stessa funzione rispondeva «è un allegato?» al guardiano
anti-SSRF e alla decisione di firmare. Una risposta sola va bene finché è la
risposta più stretta delle due: nel dubbio si stringe, non si allarga.

Vale anche quando non riesci a costruire il furto. Lì per lì la credenziale
finiva comunque su un host di Google, che a chi possiede il bucket non fa
vedere le intestazioni delle richieste, e un rimbalzo verso un altro sito
l'avrebbe fatta cadere per strada. Non era un furto dimostrato: era la
garanzia che mancava, e metterla costava un confronto. **Una garanzia che costa
una riga si mette anche senza un exploit in mano**, perché l'exploit lo trova
chi arriva dopo.

## La credenziale non è l'unica cosa che si attacca a un indirizzo

Il giro 2 della stessa verifica ha trovato la seconda porta, e vale la pena
tenerla accanto alla prima perché la causa è identica e il sintomo no. Lo stesso
indirizzo scritto da chi manda la segnalazione diventava, nel riquadro dei
feedback, un **collegamento cliccabile**: pillola col nome scelto dal mittente
(`schermata.png`), `href` verso l'indirizzo scritto da lui. Bastava mandare una
segnalazione, senza account e senza avere Filo, per mettere un'esca dentro una
pagina di Filo davanti a ogni tester che apre l'elenco. Nessuna credenziale
partiva: partiva l'utente.

La dashboard lo stesso indirizzo lo controllava già, perché lì l'allegato passa
dal canale del main. Due strade per la stessa cosa, e una non guardava niente:
**quando un dato che arriva da fuori ha due consumatori, il controllo va nel
punto che li serve entrambi**, non nel primo che lo ha chiesto.

**La regola, allargata: un indirizzo che arriva da fuori non si usa mai com'è.**
Non ci si firma una richiesta, e non se ne fa un `href`. Se il posto giusto dove
portare l'utente è un contenuto di Filo, il clic passa dal canale che sa
verificare l'indirizzo e restituire il contenuto; l'`href` resta `#`.

Dove vive: `isAttachmentUrl` e `attachmentFetchHeaders` in
`src/shared/feedback.js` (pure, una fonte sola per il main e per le pagine),
con la guardia in `tests/unit/storageRulesAllegati.test.mjs`; il lato pagina in
`filesListHtml`/`resolveFileLinks` di `src/pages/feedback/feedback.js`, con la
guardia in `tests/feedback-allegato-del-mittente.spec.mjs`.

Vicino:
[Un permesso si concede col verbo stretto](un-permesso-si-concede-col-verbo-stretto-read-e-anche-list.md)
— l'altra metà dello stesso confine: lì si decide chi entra nel deposito, qui
dove esce la chiave di chi ci entra.
