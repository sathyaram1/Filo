# La via d'uscita non sta dentro la cosa da riparare

[← Tutti i pattern](../PATTERNS.md)

Un gesto che serve a sbloccare una riparazione (approvare una fusione, rimettere
a posto una configurazione, tornare a una versione di prima) non può avere come
unica strada la cosa che potrebbe essere rotta. Ci vuole una seconda strada che
non dipenda da lei, con **la stessa identità e gli stessi controlli del server**:
mai una scorciatoia che li salta.

Il caso (#489). Quando i controlli di sicurezza del server fermano una fusione,
il sì dell'owner si dava solo dentro Filo, in Gestione. Funzionava, ma se il
lavoro fermo fosse stato proprio quello che impedisce a Filo di partire, non ci
sarebbe stato nessun modo di approvarlo. La prima toppa era uno strumento da
riga di comando che pubblicava senza passare dai controlli: è stato tolto
apposta, perché un'uscita d'emergenza che scavalca il muro è un buco nel muro.

La strada giusta è stata una pagina statica raggiungibile da qualunque browser
(`site/approvazioni`, pubblicata su Firebase Hosting del progetto) che:

- accede con lo stesso account Google e chiama la stessa funzione del server
  dell'app, che non distingue le due superfici e non concede niente di più;
- disegna le stesse card dell'app, copiate dalla stessa sorgente da
  `scripts/build-approvazioni.mjs` (una sentinella pretende le copie allineate),
  così le due superfici non divergono;
- è pubblicata da `main`, come le regole: il giorno che serve è già lì;
- è nominata dove l'owner sta guardando quando il blocco nasce, cioè nel
  terminale del finish.

Ciò che la seconda strada non deve fare: tenere le credenziali su disco (la
persistenza è in memoria), prendere l'indirizzo del server da fuori, lasciarsi
incorniciare da un'altra pagina. Le regole misurabili stanno in
`tests/unit/approvazioniWeb.test.mjs` e `tests/approvazioni-web.spec.mjs`.
