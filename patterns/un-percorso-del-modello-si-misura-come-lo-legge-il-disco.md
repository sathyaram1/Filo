# Un percorso del modello si misura come lo legge il disco, e la rete non si guarda nemmeno

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Un percorso scritto da un modello passa da UNA pulizia (`pulisciPercorso` di `src/shared/cmdClassify.js`)
sia per chi ne misura il costo sia per chi tocca il disco, e il costo si misura sul percorso **risolto** da chi leggerà
(per la ricerca nei documenti: `cartellaChiesta` dell'indice, passata al costo come `_cartella` e sempre riscritta dal
main). Chi tocca il disco rimisura il percorso risolto prima di aprirlo, come LEGGI_DOCUMENTO.

Un percorso che porta a un altro computer della rete si rifiuta **prima** di ogni accesso al disco, stat ed
`existsSync` compresi: `percorsoDiRete` / `percorsoDelFile` di `src/main/services/documentRead.js`, che chiamano la regola
del perimetro (`diRete`) e le lettere d'unità di rete (`shell.unitaDiRete`), sul percorso scritto e su quello risolto.
Fa eccezione solo una cartella dentro una che l'utente ha messo lui nell'elenco delle Preferenze: quel computer l'ha
scelto lui.

## Il caso che l'ha fatta nascere

#1499, da un audit di sicurezza. Il costo di CERCA_DOCUMENTI toglieva solo una coppia di virgolette dritte; l'indice
toglieva anche apici e caporali spaiati. Con `«\\host\share` il costo vedeva un nome relativo nella cartella di adesso
(costo 0, nessuna domanda) e l'indice un percorso di rete assoluto, che guardava con uno stat. Su Windows basta quello
stat perché il sistema si presenti a quel computer con l'identità dell'utente; il nome del computer lo sceglie il
modello, che può averlo letto in un testo ostile. Il bottone del file in chat faceva lo stesso al clic, con l'etichetta
scelta dal modello al posto del nome vero.

## Dove sta

- Pulizia e regola della rete: `src/shared/cmdClassify.js` (`pulisciPercorso`, `diRete`).
- Disco: `src/main/services/documentRead.js` (`normalizePath`, `percorsoDiRete`, `percorsoDelFile`),
  `src/main/services/documentiIndice.js` (`voceCartella`, `cartellaChiesta`), `src/main/services/handlers/file.js`.
- Porta delle uscite: `src/shared/urlExfil.js` (CERCA_DOCUMENTI e APRI_FILE verso un altro computer).
- Sentinelle: `tests/unit/percorsiDiRete.test.mjs`; nell'app `tests/cerca-documenti.spec.mjs`.
