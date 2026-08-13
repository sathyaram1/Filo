# Test visivi / agentici di Filo

Due strumenti complementari per scoprire problemi UI (specie quelli **compositi**
shell + WebContentsView, che i normali test Playwright per-pagina non vedono).

Entrambi catturano la **finestra reale composita** (shell + WebContentsView) tramite
`captureComposite` in `driver.mjs`:

- **Windows**: Win32 `PrintWindow(PW_RENDERFULLCONTENT)` — cattura il contenuto
  anche se la finestra non è in primo piano/occlusa.
- **Linux/xvfb** (cloud): `scrot` cattura il framebuffer X11 del display virtuale —
  già include il composito Electron completo. Richiede `scrot` installato
  (`apt-get install -y scrot`) e la variabile `DISPLAY` impostata da `xvfb-run`.
  Fallback: `xwd` + ImageMagick `convert`.

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
| `rclick-view:SEL` | tasto destro su selettore della view attiva (apre il menu Filo) |
| `type:TESTO` | digita nella view attiva |
| `key:KEY` | premi un tasto (`Enter`, `Control+b`, …) |
| `wait:MS` | attendi |

Opzioni: `--out DIR`, `--file scenario.txt`.

## 2. `explore.mjs` — esplorazione AUTONOMA guidata da un LLM vision

Un modello Gemma (pesi aperti) riceve gli screenshot (con badge numerati), naviga come un
utente e segnala comportamenti inattesi. Al termine scrive `report.md` +
`issues.json` + gli screenshot di ogni passo in `tests/agent/reports/<timestamp>/`.

Il modello riceve l'**intera cronologia** della sessione (tutti gli screenshot
precedenti + le sue risposte), così riconosce cambiamenti inattesi (es. contenuto
che prima c'era e ora è sparito). Qui si paga a token, quindi nel contesto
restano gli ultimi 8 screenshot: i più vecchi lasciano solo il testo.

```bash
# esplorazione libera
npm run test:explore

# mirata su un'area
npm run test:explore -- --area "editor: scrittura e moduli" --start filo://editor/editor.html --steps 12

# COMPITO concreto: forza un percorso utente reale e segnala i bug incontrati.
# Utile dopo aver implementato una feature: dai un compito che la usa.
npm run test:explore -- --start filo://editor/editor.html --steps 10 \
  --task "Scrivi un titolo e un paragrafo, cambia pagina con lo switch, usa Cerca e sostituisci"

# modello più economico (run lunghi)
npm run test:explore -- --model google/gemma-4-26b-a4b-it
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

## Chiave API (OpenRouter)

La chiave si legge da:
1. env `OPENROUTER_API_KEY`, oppure
2. il file `tests/agent/.env` (gitignorato) con `OPENROUTER_API_KEY=...`

**Niente chiave Google.** La politica sui modelli di Filo vale anche per gli
strumenti che lo testano: si usano solo modelli a **pesi aperti** serviti da
**fornitori indipendenti**. Gemma va bene perché i pesi sono aperti; erano i
server di Google a essere esclusi. La lista di esclusione dei produttori viaggia
con ogni richiesta ed è la stessa dell'app (`src/shared/constants.js`, niente
copia locale che possa divergere); a risposta arrivata si controlla **chi l'ha
davvero servita** e il run si ferma se è qualcuno che doveva restare fuori.

Modelli vision usati:

| modello | note |
|---------|------|
| `google/gemma-4-31b-it` | **default** — pesi aperti, vede le immagini, buon compromesso |
| `google/gemma-4-26b-a4b-it` | più economico → fallback automatico e run lunghi |
| `qwen/qwen3-vl-32b-instruct` | alternativa vision a pesi aperti |

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
