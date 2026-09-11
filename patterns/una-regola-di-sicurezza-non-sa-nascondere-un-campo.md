# Una regola di sicurezza non sa nascondere un campo

[← Tutti i pattern](../PATTERNS.md)

Le regole di Firestore decidono **se** un documento si legge, non **quali campi**
tornano. Quindi una superficie pubblica che deve mostrare tre campi di un
documento che ne ha venti non si serve «filtrando lato client»: quel filtro
decide solo cosa si disegna, mentre il documento intero è già arrivato sul
computer di chi guarda — e chiunque può rifare la stessa richiesta con `curl`.
Se una parte di un documento è pubblica e il resto no, **la parte pubblica deve
esistere come dato a sé**: una vista, scritta da chi ha l'autorità, che contiene
solo quei campi.

Il caso (audit pre-alpha, #583). La collezione `feedback` aveva
`allow read: if true` perché la bacheca degli utenti mostra i fix usciti. Testo
e URL erano cifrati per l'owner, ma tutto il resto no — titolo, user agent, link
agli screenshot (in un bucket aperto), numero, data — e i documenti anteriori al
cutover della cifratura erano in chiaro per intero, note di lavorazione
comprese. Con la sola chiave web del repo si ricostruiva cosa stavano provando i
tester e su quali pagine.

Come si fa, in tre mosse.

**Elenca i lettori legittimi, e dài a ciascuno la sua strada.** Non esiste «la
lettura»: esistono l'owner dalla sua dashboard (credenziali admin), il server
(identità propria, o Admin SDK che bypassa le regole) e il pubblico (la vista).
Sono tre porte diverse, e ognuna va aperta apposta. Chiudere senza aprirle è
rompere l'app — vale qui come per
[«Sei loggato» non è un permesso](sei-loggato-non-e-un-permesso.md).

**La vista la scrive chi può DECIDERE.** Per dire «questo fix è chiuso e non è
mai passato dalle mani della sicurezza» bisogna leggere lo status vero, che
viaggia cifrato: può farlo solo chi ha la chiave, cioè l'owner (o il server). La
decisione sta in un modulo puro (`src/shared/feedbackPublicView.js`), la
esegue il main dell'owner a ogni triage, e le regole ripetono l'elenco dei campi
ammessi come rete: una scrittura con un campo fuori elenco viene respinta
intera. La regola che fa male sbagliare: **in dubbio, niente scheda** — status
illeggibile, pipeline non decifrato, un solo giudice che ha gridato «attacco» e
quel feedback non esiste per il pubblico.

**Il token di chi legge non scende in pagina.** Le superfici dell'owner girano
in una pagina `filo://`, dove un ID token non deve arrivare: la pagina CHIEDE la
lettura al main (`MSG.FEEDBACK_FETCH`), che la esegue con le credenziali e
rifiuta chi non è admin e chi non chiama da una superficie di Filo.

Un effetto collaterale da mettere in conto: **quello che il pubblico leggeva
senza saperlo, smette di arrivare**. Il contatore dei numeri dei feedback si
ricavava da una query sulla collezione, e l'invio è anonimo per scelta: senza
un'altra strada (`counters/feedbackSeq`, che chiunque può far avanzare di uno e
nessuno può riscrivere) i feedback nuovi sarebbero nati senza numero. Prima di
chiudere una lettura, cerca chi la stava usando per fare altro.

Dove vive: `firestore.rules` (`match /feedback`, `match /feedback-public`,
`match /counters`), `src/shared/feedbackPublicView.js` (chi ha una scheda e con
quali campi), `src/shared/feedback.js` (`listPublic`/`publishPublicCard`, e le
letture che passano dal main), `src/main/services/handlers/auth.js` (il
pubblicatore e il cancello owner-only), `scripts/publish-public-view.mjs` (la
prima pubblicazione a mano, dopo il deploy delle regole). Sentinelle:
`tests/unit/firestoreRulesFeedbackRead.test.mjs` (le regole non tornano
pubbliche e la vista non ammette campi sensibili) e
`tests/unit/feedbackPublicView.test.mjs` (cosa finisce in una scheda).

E come per ogni regola: **finché non gira `firebase deploy --only
firestore:rules`, la porta in produzione è ancora quella di prima.**
