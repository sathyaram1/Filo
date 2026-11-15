## La consegna porta la prova accanto

La messa in revisione porta `--consegna <file.json>`, scritto fuori dal repo
come la domanda. Canale e server la controllano con la stessa regola
(`src/shared/consegna.js`) e la rifiutano dicendo quale riga manca.

```json
{
  "criteri": [
    { "criterio": 1, "esito": "fatto", "prova": "tests/manage-x.spec.mjs, caso «salva col titolo vuoto»" },
    { "criterio": 5, "esito": "non si applica", "motivo": "nessun elemento grafico toccato: solo il canale" }
  ],
  "elementi": [
    { "elemento": "Bottone Riprova", "perche": "senza, l'errore resta senza uscita",
      "clic": "rifà la chiamata", "destro": "menu della riga, con Riprova", "trascina": "non serve: è un'azione",
      "hover": "«Riprova» in due parole" }
  ],
  "classe": { "valore": "nascosto", "motivo": "cambia cosa si manda al modello, non i dati salvati" }
}
```

- **`criteri`**: una riga per ognuno dei nove criteri qui sopra, col loro
  numero. La prova è una cosa che un altro controlla senza rifare il lavoro:
  il nome di un test e del caso, il percorso di una schermata in
  `tests/.shots/`, un elenco (strade provate, file, input insoliti). «L'ho
  guardato» non vale. Un criterio che non si applica si dichiara col motivo,
  non si salta.
- **`elementi`**: in un lavoro sull'interfaccia (il ramo tocca `src/pages/`,
  `src/renderer/`, `src/content/`, `src/styles/`, un `.html` o `.css`,
  `site/`) ogni elemento nuovo (titolo, bottone, riquadro, voce), col motivo
  per cui non si può togliere e con cosa fanno clic, tasto destro,
  trascinamento e hover, o perché non servono. Se non ne aggiunge nessuno:
  `"elementi": []` e `"nessunElemento": "<perché>"`.
- **`classe`**: la conseguenza peggiore di un difetto nel lavoro finito, non il
  file dove sta il codice, con una riga di motivo. Nel dubbio la più bassa.
  - `visibile`: lo nota il primo che usa la cosa, e la versione dopo lo
    sistema (interfaccia, testi, una funzione che si vede);
  - `nascosto`: può restare sbagliato per giorni o sprecare soldi, ma si
    sistema (logica dietro, cosa si manda ai modelli e quanto costa, strumenti
    delle routine e del manutentore, Gestione);
  - `irreparabile`: si perde qualcosa che non torna (formato dei dati salvati e
    migrazioni, conferme prima di un'azione o di un comando, cosa esce dalla
    macchina, crediti, aggiornamento e installatore, chi può fondere o è
    fidato).

  Il server mette da sé il minimo `irreparabile` a un ramo che tocca una di
  queste sei zone (l'elenco stretto sta in `src/shared/consegna.js`; le prove
  non contano), vale la più alta delle due, e registra chi l'ha decisa.

La prova del test nuovo la fa uno strumento senza modello: corre i casi nuovi o
cambiati del ramo senza le modifiche del lavoro (rosso atteso) e con (verde
atteso), e il canale attacca l'esito alla consegna; quello scritto a mano nel
file non vale. Lancialo tu, in sottofondo, insieme a `npm run finish:check`:
`node scripts/prova-test-nuovi.mjs` (in un lavoro server con
`--server "/root/filo-security"`). La consegna riprende quell'esito se la punta
è la stessa, altrimenti lo rifà. Un caso verde anche senza il lavoro esce
segnalato: o la prova non prova il lavoro e la correggi, o nella riga del
criterio 1 dici perché.
