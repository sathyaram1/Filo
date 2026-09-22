# Un divieto scritto su una PAROLA non è un divieto: si elenca ciò che è ammesso

[← Tutti i pattern](../PATTERNS.md)

Filo cambia l'aspetto di una pagina iniettandoci un foglio di stile scritto dal
modello. Il modello può aver letto la pagina di qualcun altro, quindi quel
foglio va ripulito, e la cosa da impedire era chiara e scritta in cima al file:
**nessuna richiesta di rete dal CSS iniettato**. Solo che il filtro non vietava
quella cosa: vietava `url(`, cioè la parola con cui di solito la si scrive. E
la stessa cosa si scrive anche `image-set("https://…")`, `-webkit-image-set(…)`,
`src("…")`, e domani in un altro modo ancora. Tutte passavano intere.

Risultato (#533, decimo giro di verifica): dopo aver letto un documento
dell'utente, il foglio di stile che Filo metteva nella pagina andava a prendere
un'immagine a un indirizzo scelto da chi aveva scritto il documento, con dentro
l'IBAN appena letto. Nessun clic, nessuna conferma, e niente nella pagina
Sicurezza, perché nessuno aveva rifiutato niente.

- **L'elenco delle cose vietate non finisce mai**, perché non lo scrivi tu: lo
  scrivono le specifiche CSS, i produttori dei browser e chi attacca. L'elenco
  delle cose AMMESSE lo scrivi tu, ed è corto: le funzioni che servono davvero
  all'estetica di un testo stanno in venti righe, e nessuna sa andare in rete.
- **Il divieto va scritto sull'ESITO che vuoi impedire**, non su una sua
  scrittura: «questo valore può andare in rete?» è la domanda, e si risponde
  chiedendo se ogni notazione funzionale che compare sta nell'elenco.
- **Chiudi anche le scritture equivalenti che non hai visto**: il prefisso del
  produttore si toglie prima di cercare nell'elenco (`-webkit-linear-gradient`
  resta ammessa, `-webkit-image-set` no), e il backslash resta vietato di per
  sé, perché un escape CSS fa leggere al browser un token diverso da quello
  scritto.
- **La sentinella deve elencare le scritture, non il codice**: in
  `tests/unit/pageRestyle.test.mjs` c'è una prova sola con dentro tutte le
  forme equivalenti (`url(`, `image-set`, `-webkit-image-set`, `src(`,
  `cross-fade`, `expression(`), più la prova che l'estetica vera — colori,
  gradienti, `calc()`, trasformazioni, filtri — continua a passare: senza
  quest'ultima l'elenco degli ammessi si stringe fino a rompere la funzione.
- **Dove:** `FUNZIONI_OK` e `soloFunzioniAmmesse` in
  `src/shared/pageRestyle.js`. L'esito per l'utente lo guarda
  `tests/filo-esce-dopo-una-lettura.spec.mjs`.
