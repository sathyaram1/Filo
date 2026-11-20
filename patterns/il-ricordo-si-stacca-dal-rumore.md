# Il ricordo si stacca dal rumore, non supera una soglia fissa

[← Tutti i pattern](../PATTERNS.md)

Prima di rispondere Filo ripesca dagli scambi più vecchi della finestra quelli vicini alla domanda (vettori del
modello che indicizza la Cronologia). Con una soglia fissa di 0,45 sul coseno ripescava quasi sempre tre scambi
che non c'entravano (#2369): due frasi qualunque in italiano stanno già fra 0,4 e 0,6.

## Le misure (19 novembre 2026)

33 scambi realistici, 20 domande, vettori a 256 dimensioni quantizzati come nell'app. Per ogni domanda: la
mediana dei coseni su tutti gli scambi e lo stacco dei migliori da lì.

| modello | mediana | ricordi giusti | rumore più alto |
|---|---|---|---|
| qwen3-embedding-8b | 0,29-0,46 | 0,68-0,88, stacco +0,25…+0,48 | fino a 0,66, stacco al più +0,22 |
| text-embedding-3-small | 0,15-0,32 | 0,58-0,78, stacco +0,28…+0,52 | fino a 0,56, stacco al più +0,24 |

- Il valore assoluto cambia col modello, lo stacco dalla mediana quasi no: la regola è «sopra la mediana di 0,25»,
  con 0,45 come pavimento.
- Con meno di 8 confronti la mediana non misura il rumore: lì decide il ricordo per parole.
- I saluti si somigliano fra loro («ciao» contro uno scambio «ciao come va»: 0,80, stacco +0,34): una domanda senza
  parole che distinguono non ripesca niente, prima ancora di chiedere i vettori.

Regola e numeri: `ricordiPerVicinanza` e `domandaConArgomento` in `src/shared/filoContesto.js`; sentinella
`tests/unit/ricordoPerVicinanza.test.mjs`. Un modello d'indicizzazione nuovo si rimisura con lo stesso metodo prima
di cambiare i numeri.
