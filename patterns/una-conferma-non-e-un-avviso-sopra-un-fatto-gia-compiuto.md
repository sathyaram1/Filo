# Una conferma non è un avviso sopra un fatto già compiuto

[← Tutti i pattern](../PATTERNS.md)

Se all'utente si chiede «vuoi davvero?», quello su cui deve poter dire no **non
deve essere già accaduto**. L'effetto si ferma in un posto che non è dell'utente
e ci arriva solo col sì; e la porta che produce l'effetto è **una**, dentro, non
una guardia su ogni superficie che la offre.

## Il caso che l'ha fatto nascere

Feedback #588. Uno scaricamento con estensione eseguibile (`.exe`, `.dmg`,
`.sh`…) atterrava nella cartella Download come un PDF, e «Apri file» lo passava
a `shell.openPath`, che su Windows lo esegue. La prima idea era quella comoda:
lasciar scendere il file dov'è sempre sceso e mettere sopra un avviso. Sbagliata
per due motivi.

Il primo: un avviso sopra un file già in cartella non è una scelta. L'utente che
risponde «no» ha comunque un programma nella cartella dove va a cercare le cose,
con il nome che gli ha dato il sito; il doppio clic che lo esegue non passa più
da Filo. La conferma diventa un cartello, non un cancello.

Il secondo: `will-download` di Electron è **sincrono** e vuole `setSavePath`
subito, o mostra il dialogo nativo di sistema. Annullare per poi ri-scaricare
dopo il sì sembra la strada naturale ed è una trappola: il secondo scaricamento
è una richiesta NUOVA, e su un indirizzo a uso singolo (token, POST, link
firmato) non riscarica niente. Quindi i byte scendono subito, ma in una cartella
`quarantena` dentro i dati dell'app: nessun gestore file la mostra, il percorso
non esce nemmeno verso le superfici interne, e il file entra nella cartella
Download solo quando arriva il sì (`completa()`). Un no lo cancella; un riavvio
la svuota, perché una conferma non sopravvive a chi l'avrebbe data.

## L'attrito si mette dove passa la decisione

«Apri file» esiste in tre posti: l'avviso di fine scaricamento, il pannello
della barra in alto, la pagina elenco. Tre guardie sarebbero tre occasioni di
dimenticarne una — e la quarta superficie, quella di domani, nascerebbe senza.
Il controllo sta **in `openFile()` nel main**, l'unica funzione che chiama
`shell.openPath`: senza `confirmed` risponde `needsConfirm` con la frase da
mostrare, e ogni superficie decide solo *come* chiederlo (popup nella pagina,
notifica nella barra). Chi aggiunge una superficie nuova eredita la difesa senza
saperlo.

Corollario sui nomi: la decisione si prende sul nome **vero**, la si mostra col
nome **leggibile**. `fattura‮txt.exe` si legge «fatturatxt.exe» e resta un
eseguibile; punti e spazi in coda su Windows non contano (`setup.exe.` apre lo
stesso programma), quindi si tolgono prima di guardare l'estensione. Regole e
frasi in `src/shared/eseguibili.js`, casi limite in
`tests/unit/eseguibili.test.mjs`.

## Dove vive

- `src/main/services/downloads.js` — quarantena, `completa()`, `confirmDownload()`, il cancello in `openFile()`.
- `src/shared/eseguibili.js` — la lista delle estensioni, il nome leggibile, i siti fidati, le frasi.
- `tests/downloads-eseguibili.spec.mjs` — senza il sì il file non è in cartella; `shell.openPath` non viene chiamata prima della seconda conferma.

Vicini: [Azione distruttiva: l'"Annulla" effimero non può essere l'UNICA rete](azione-distruttiva-lannulla-effimero-non-puo-essere-lunica.md),
[Un avviso che grida al lupo smette di essere letto](un-avviso-che-grida-al-lupo-smette-di-essere-letto.md).
