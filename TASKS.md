# TASKS — promemoria di azioni owner

> **Nota sul modello di lavoro.** Non esiste più una grande coda pubblica qui. Il
> lavoro si distribuisce così:
>
> - **Lavoro di prodotto** (fix/feature di Filo): vive nei **feedback** (Firestore,
>   collezione `feedback`). Le routine cloud lo selezionano via
>   `scripts/dispatch.mjs`; in locale lo si discute/risolve (vedi `LOCAL.md`).
> - **Lavoro delle routine**: scelto deterministicamente da `scripts/dispatch.mjs`
>   (precedenza secaudit → verifier → fixer → new-work → prober). Recipe in
>   `ROUTINES.md` + `routines/`.
> - **Backend privato**: vive in **`filo-security/TASKS.md`** (repo separato, le
>   routine non lo vedono).
>
> Questo file resta **solo** per ricordare le **azioni che spettano all'owner**
> (cose che Claude non può fare da solo: scheduling su claude.ai, segreti nelle
> sandbox cloud, deploy che richiedono una riautenticazione owner). Lo storico dei
> task completati vive nella history git.

## Azioni owner in sospeso

- [ ] **R5 — Scheduling 2 account sfasati su claude.ai** — Crea/aggiorna la routine
  su **entrambi** gli account Filo (non quello privato), cron ogni 6h **sfasati**:
  account A `0 0,6,12,18 * * *`, account B `0 3,9,15,21 * * *` (insieme coprono
  ogni ~3h, ogni run trova una finestra 5h fresca). Verifica che `git push origin
  main` sia autenticato nella sandbox di **entrambi** gli account. _(Non è codice:
  si fa nell'UI delle routine su claude.ai.)_

- [ ] **S1.5 cutover — Chiave privata nelle 2 sandbox cloud** — Il flag di
  cifratura è già acceso (cutover fatto in locale). Per **riaccendere le routine
  cloud** serve la chiave privata dei feedback (`FILO_FEEDBACK_PRIVKEY`, base64
  PKCS8) in **entrambe** le sandbox dei 2 account. ⚠️ **NON** metterla nel campo
  "Variabili d'ambiente" del dialog ambiente cloud (è dichiarato visibile/non
  segreto) → passala **nel prompt** della routine (`FILO_FEEDBACK_PRIVKEY=<base64>`),
  come da design "chiave nel prompt". Senza, i worker non possono decifrare i corpi
  dei feedback.

- [ ] **Deploy functions — filo-security** — Il backend privato ha codice su
  `origin/main` non ancora in produzione: il trigger sanitizer
  (`onFeedbackClosedSanitize`), la decifratura dei feedback prima dei giudici, il
  nome modello nei verdetti e l'onoramento dell'override owner. Vanno **deployati**:
  dalla root di `filo-security`, `firebase deploy --only functions:security` (o
  `--only functions`). Prima serve provisionare il secret
  `firebase functions:secrets:set FILO_FEEDBACK_PRIVKEY` (il valore della chiave ce
  l'ha l'owner). ⚠️ I comandi `firebase functions:secrets:*` hanno dato
  "Authentication Error" il 2026-06-25: fare **`firebase login --reauth`** prima.
  È il **primo deploy** del backend sicurezza sul flusso feedback live → confermare.
