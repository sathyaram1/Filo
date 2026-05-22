# Test visivi / agentici di Filo

Due strumenti complementari per scoprire problemi UI (specie quelli **compositi**
shell + WebContentsView, che i normali test Playwright per-pagina non vedono).

Entrambi catturano la **finestra reale composita** via Win32 `PrintWindow`
(`PW_RENDERFULLCONTENT`): cattura il contenuto della finestra Filo anche se non è
in primo piano o è occlusa, quindi è robusto e non dipende dal focus.

## 1. `shoot.mjs` — controllo visivo SCRIPTATO (deterministico, niente LLM)

Per il controllo a vista dopo aver implementato una feature. Esegui una sequenza
di passi e ispeziona gli screenshot salvati.

```bash
npm run test:shoot -- "nav:filo://editor/editor.html; shot:editor; click-shell:#nav-apps; shot:appsmenu"
# screenshot in tests/agent/.out/*.png
```

Passi (separati da `;`):

| passo | effetto |
|-------|---------|
| `nav:URL` | naviga la tab attiva |
| `tab:URL` | apri una nuova tab |
| `shot:NOME` | screenshot composito → `.out/NOME.png` |
| `marks:NOME` | come `shot` ma con badge numerati sugli elementi cliccabili (+ stampa la mappa) |
| `click-shell:SEL` | click su selettore CSS della shell (tab bar / barra indirizzi) |
| `click-view:SEL` | click su selettore CSS della view attiva |
| `type:TESTO` | digita nella view attiva |
| `key:KEY` | premi un tasto (`Enter`, `Control+b`, …) |
| `wait:MS` | attendi |

Opzioni: `--out DIR`, `--file scenario.txt`.

## 2. `explore.mjs` — esplorazione AUTONOMA guidata da un LLM vision

Un modello Gemini/Gemma riceve gli screenshot (con badge numerati), naviga come un
utente e segnala comportamenti inattesi. Al termine scrive `report.md` +
`issues.json` + gli screenshot di ogni passo in `tests/agent/reports/<timestamp>/`.

Il modello riceve l'**intera cronologia** della sessione (tutti gli screenshot
precedenti + le sue risposte), così riconosce cambiamenti inattesi (es. contenuto
che prima c'era e ora è sparito). I modelli AI Studio sono tariffati a chiamata,
non a token → contesto lungo non costa di più.

```bash
# esplorazione libera
npm run test:explore

# mirata su un'area
npm run test:explore -- --area "editor: scrittura e moduli" --start filo://editor/editor.html --steps 12

# COMPITO concreto: forza un percorso utente reale e segnala i bug incontrati.
# Utile dopo aver implementato una feature: dai un compito che la usa.
npm run test:explore -- --start filo://editor/editor.html --steps 10 \
  --task "Scrivi un titolo e un paragrafo, cambia pagina con lo switch, usa Cerca e sostituisci"

# modello più capace (quota più bassa)
npm run test:explore -- --model gemini-3.5-flash
```

Opzioni: `--model`, `--steps`, `--start URL`, `--area "testo"`, `--task "testo"`,
`--out DIR`, `--no-feedback`, `--min-severity low|medium|high`.

- `--area`: *dove* concentrarsi (esplorazione guidata).
- `--task`: *cosa fare* (obiettivo concreto); il modello lo esegue con interazioni
  reali e segnala ogni bug lungo il percorso. Preferiscilo per testare una feature
  appena fatta.

### Giro completo

```bash
npm run test:daily            # esplora dashboard, editor, shell/tab, history, options
```
Aggrega tutto in `tests/agent/reports/daily-<ts>/INDEX.md`.

## Chiave API (Google AI Studio)

La chiave si legge da:
1. env `GEMINI_API_KEY` (o `GOOGLE_AI_API_KEY`), oppure
2. il file `tests/agent/.env` (gitignorato) con `GEMINI_API_KEY=...`

Modelli vision testati (free tier AI Studio — le quote variano):

| modello | note |
|---------|------|
| `gemini-3.1-flash-lite` | **default** — buon compromesso qualità/quota, JSON affidabile |
| `gemini-3.5-flash` | più capace, quota giornaliera bassa → run mirati |
| `gemma-4-31b-it` / `gemma-4-26b-a4b-it` | quota molto alta; vedono le anomalie ma meno disciplinati sul formato JSON |

## Quando usare cosa

- **Dopo una feature**: `test:shoot` con uno scenario mirato → guardo gli
  screenshot a colpo d'occhio. Veloce, ripetibile, gratis.
- **Caccia a problemi non previsti**: `test:explore` / `test:daily` lasciando
  esplorare il modello su un'area.

## Limiti noti

- DPI: la cattura assume scaling schermo 100%. Con scaling diverso, allineare
  `captureComposite` (driver) — al momento usa `PrintWindow` sul rettangolo finestra.
- I modelli a bassa disciplina (Gemma) possono produrre falsi positivi: pesare la
  severità e incrociare con gli screenshot allegati.
- Solo Windows (cattura via PowerShell/Win32). Per mac/Linux serve un equivalente
  di `PrintWindow`.
