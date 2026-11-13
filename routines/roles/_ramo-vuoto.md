## Un ramo che non porta niente

Se il payload porta `ramoVuoto`, o se dopo il rebase `git diff --stat origin/main...HEAD` non stampa niente, il ramo
non ha nessuna modifica rispetto a main: quello che il lavoro aveva fatto è già lì, fuso per un'altra strada o tolto
dal rebase perché c'era già (#1363, #1965). La fusione che lo contiene la trovi con
`git log origin/main --oneline --grep "<payload.num>"`.

- Chi riallinea non ha niente da riportare: niente unit e niente spec. Consegna subito, con
  `--motivo "altro: il lavoro è già tutto su main (<sha della fusione>)"` e la stessa riga nel report.
- Chi verifica non cerca un diff: verifica la richiesta sul codice com'è, che è main. Se è soddisfatta, la critica lo
  dice, con la fusione che la contiene, e non ha rilievi; se manca qualcosa, il rilievo dice cosa manca.
