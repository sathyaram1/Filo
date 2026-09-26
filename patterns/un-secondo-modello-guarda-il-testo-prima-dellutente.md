# Un secondo modello guarda il testo prima dell'utente

[← Tutti i pattern](../PATTERNS.md)

**Regola.** Il testo che Filo mostra dopo aver letto roba scritta da altri
(una mail, una pagina) passa da una porta sola: prima controlli deterministici
in locale, poi un secondo modello — **diverso** da quello che il testo l'ha
scritto. Se quel secondo modello non c'è o non risponde, il testo **non
compare e non si perde**: resta in coda, in vista, e riparte dopo. «Non lo so»
non è «passa».

## Il caso

La notifica è un canale d'attacco. Una mail scritta bene può far scrivere a
Filo «la tua banca chiede di confermare le credenziali, apri qui», e l'utente
si fida di Filo, non del mittente. Il testo verso l'utente non costa niente e
non chiede conferme: passa sempre. Per questo il controllo non può stare nel
modello che il testo l'ha prodotto — è già dentro al contesto avvelenato, e due
contesti sullo stesso modello condividono le stesse debolezze e cadono insieme.

## Come si fa

- **Una porta sola, e chi la salta si rompe.** Il magazzino delle notifiche
  RIFIUTA una voce contaminata senza il timbro del controllo: non è un
  promemoria da ricordarsi, è un errore. Una superficie nuova che se ne
  dimentica lo scopre subito, invece di mostrare a un utente quello che gli ha
  scritto un estraneo.
- **Prima quello che non costa niente.** Codici usa e getta, chiavi, coordinate
  bancarie, un segreto custodito da Filo, un collegamento che non porta dove
  dice: sono forme, si riconoscono in locale, funzionano a rete staccata e non
  chiamano nessun modello.
- **Il modello diverso è un requisito, non una preferenza.** La catena del
  guardiano perde i soprannomi usati da chi ha scritto il testo; se non resta
  niente, l'avviso va in coda.
- **I motivi sono chiusi.** Il guardiano sceglie una chiave da un elenco, non
  scrive la frase: la riga che l'utente legge nasce nel codice, quindi un testo
  ostile non arriva a scriverla nemmeno convincendo il modello. Stessa idea del
  giudice dei siti pericolosi.
- **I blocchi devono restare rari, e si devono poter contare.** Un guardiano
  che grida al lupo viene spento: il registro dei blocchi sta in Preferenze e si
  legge anche quando è vuoto. Del testo fermato non si conserva un'anteprima
  quando è stato fermato proprio perché conteneva un segreto.
- **I collegamenti dicono dove portano.** Dentro un avviso la scritta di un
  link non la sceglie chi ha scritto l'avviso: vedi
  [Un collegamento dice dove porta](un-collegamento-dice-dove-porta.md).
- **Il materiale che si passa alla guardia va appiattito e dichiarato**, come
  in [Un modello che fa da guardia legge testo di terzi: appiattiscilo e dichiaralo](un-modello-che-fa-da-guardia-legge-testo-di-terzi.md).

## Dove vive

- `src/shared/fiducia.js` — quanto ci si fida delle fonti di un compito.
- `src/shared/guardianoStatico.js` — i controlli deterministici.
- `src/shared/guardiano.js` — la domanda, i motivi chiusi, la regola del
  modello diverso.
- `src/main/services/guardianoAvvisi.js` — la porta: statici, guardiano, coda.
- `src/shared/filoMemory.js` — il magazzino che rifiuta un avviso senza timbro.
- Guardie: `tests/unit/guardianoStatico.test.mjs`, `tests/unit/guardiano.test.mjs`,
  `tests/unit/guardianoBanco.test.mjs` e `tests/guardiano-avvisi.spec.mjs`.
