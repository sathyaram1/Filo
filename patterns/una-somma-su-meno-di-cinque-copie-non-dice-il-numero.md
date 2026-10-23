# Una somma su meno di cinque copie non dice il numero

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Dove l'owner legge i contatori anonimi, un numero contato su meno di
cinque copie di Filo non si mostra: si scrive «meno di 5», e lo zero si scrive
allo stesso modo. La soglia la applica il main, prima di rispondere alla pagina,
che il numero non lo riceve mai.

## Da dove viene

Feedback #1462, la scheda Contatori di Gestione. Al lancio i tester sono pochi:
con due copie attive, «Spiega un link: 37 volte, attesa oltre 30 secondi» è il
pomeriggio di una persona riconoscibile. La decisione dell'owner è stata: solo
somme, e sotto le cinque copie niente numero.

## Le porte che lasciano passare il numero lo stesso

Una soglia applicata solo alla cella principale non basta. Il numero nascosto
esce da altre strade, e ognuna è stata chiusa:

- **Lo zero.** Se lo zero si scrive «0» e da uno a quattro «meno di 5», chi
  guarda sa che il tester solo ha usato quella funzione. Lo zero vale come gli
  altri sotto soglia, e le voci degli elenchi chiusi (azioni, funzioni,
  impostazioni, passi dell'intervista) ci sono tutte, anche mai viste.
- **Il nome.** Una voce che esiste solo perché qualcuno l'ha incontrata (un
  modello del correttore, un codice d'errore di rete, un valore scelto per
  un'impostazione) sotto soglia non esce nemmeno col nome.
- **La divisione.** Una quota (accettate su mostrate) si mostra solo se si
  mostrano i due numeri da cui nasce; una differenza (preparate meno aperte)
  lo stesso.
- **Il mese.** Lo pseudonimo cambia ogni mese, quindi a cavallo di due mesi
  tre copie sono sei pseudonimi. La soglia si misura sul mese con più copie,
  che non conta mai una copia due volte; il numero di copie mostrato è la somma
  dei mesi, e lo si dice nel suggerimento.
- **I documenti letti.** Quanti documenti ci sono in un intervallo è il numero
  di ore in cui le copie erano aperte: non esce, resta nel registro del main.
- **Il grafico.** Una colonna sotto soglia è una tacca a righe di altezza
  fissa e non si apre: la sua altezza direbbe il numero.

Resta aperta la sottrazione fra due viste (tutti i sistemi meno Windows):
chiuderla vuol dire nascondere anche celle sopra soglia, ed è una scelta
dell'owner, non di chi disegna.

## Dove sta

`src/main/services/contatoriSomme.js` (soglia, celle, voci tolte) e la porta
`CONTATORI_SOMME` in `src/main/services/handlers/contatori.js`, che applica la
stessa soglia anche ai due riquadri delle installazioni attive. La pagina
(`src/pages/manage/manageContatori.js`) scrive solo quello che riceve. Prove:
`tests/unit/contatoriSomme.test.mjs`, `tests/manage-contatori.spec.mjs`.

Vicini: [Anonimo si guarda campo per campo](anonimo-si-guarda-campo-per-campo.md),
[Un numero che non si conosce non è uno zero](un-numero-che-non-si-conosce-non-e-uno-zero.md).
