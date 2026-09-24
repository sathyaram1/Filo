// Modalità terminale della dashboard.
//
// Richiesta utente: uno switch in Preferenze attiva una "modalità terminale"
// (OFF di default). Quando è attiva:
//   - sopra la barra di scrittura compare una riga grigia con la directory;
//   - i comandi che iniziano con `/` (e non sono comandi di Filo né un sito)
//     vengono eseguiti da una shell di sistema, con output in streaming;
//   - mentre si scrive l'input cambia colore: arancione se è un comando di
//     Filo (o un sito), azzurro se è un comando da eseguire nella shell.
//
// I test ASSERISCONO il successo della feature (l'output del comando compare
// davvero, la riga directory diventa visibile, le classi di evidenziazione si
// attivano), non solo l'assenza di errori. shell.js fuori da Windows usa
// /bin/sh, quindi `/echo …` è eseguibile anche nel cloud Linux headless.

import { test, expect } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// Attiva/disattiva la modalità terminale via UPDATE_SETTINGS: il broadcast
// SETTINGS_UPDATED aggiorna la dashboard live (stesso meccanismo del commento
// home). deepMerge preserva `shell` quando si invia solo `enabled`.
async function setTerminal(page, enabled) {
  await page.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: v } } },
      (r) => resolve(r),
    );
  }), enabled);
}

// Scrive nell'input e simula la digitazione (evento `input` per l'highlight).
async function typeInput(page, value) {
  await page.evaluate((v) => {
    const input = document.getElementById('input');
    input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

// Invia il comando attualmente nell'input (submit del form).
async function submitInput(page, value) {
  await page.evaluate((v) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = v;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, value);
}

test('di default la modalità terminale è OFF: nessuna riga directory', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#dashDir')).toBeHidden();
});

test('attivando il terminale compare la riga directory e i comandi / vengono eseguiti dalla shell', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  // Attiva: la riga grigia con la directory deve comparire (initCwd → home).
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#dashDir')).not.toHaveText('');

  // Un comando `/` viene eseguito dalla shell: l'output reale compare nella
  // bolla terminale (asserisce il SUCCESSO, non l'assenza di un errore).
  await submitInput(page, '/echo filo-term-OK-7421');
  await expect(page.locator('.dash-term-out')).toContainText('filo-term-OK-7421', { timeout: 12_000 });

  // Il comando NON è finito in chat come messaggio per l'LLM: non c'è una
  // bolla "Filo sta pensando…".
  await expect(page.locator('.dash-bubble-pending')).toHaveCount(0);
});

test('la shell è PERSISTENTE per scheda: una variabile impostata sopravvive al comando successivo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  // Sintassi giusta per la shell che gira davvero: PowerShell su Windows,
  // /bin/sh nel cloud Linux. (Il primario è scelto da shell.js in base alla
  // piattaforma host, la stessa che vede questo file di test.)
  const win = process.platform === 'win32';
  const setCmd = win ? '/$env:FILO_PERSIST = "vivo-5566"' : '/export FILO_PERSIST=vivo-5566';
  const readCmd = win ? '/echo persist=$env:FILO_PERSIST' : '/echo persist=$FILO_PERSIST';

  // Primo comando: imposta la variabile in UN processo shell.
  await submitInput(page, setCmd);
  // Aspetta che il primo comando sia finito (i controlli Stop spariscono).
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });

  // Secondo comando (submit separato): legge la variabile. Col vecchio modello
  // "un processo per comando" qui uscirebbe "persist=" (variabile persa); con la
  // shell persistente esce "persist=vivo-5566".
  await submitInput(page, readCmd);
  await expect(page.locator('.dash-term-out').last())
    .toContainText('persist=vivo-5566', { timeout: 12_000 });
});

test('la cartella del terminale sopravvive alla riapertura (#259): riaprendo si resta dove si era, non alla home', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  // Cartella temporanea reale, distinta dalla home, in cui spostarsi con `cd`.
  // Il processo di test gira sulla stessa macchina della shell: ne prendiamo il
  // path canonico, quello che la shell riporterà come $PWD / %cd% dopo il cd.
  // (Su Windows con un nome utente che contiene uno spazio, `os.tmpdir()` dà la
  // forma abbreviata 8.3 e la shell risponde con quella lunga: vedi
  // tests/helpers/percorsi.mjs.)
  //
  // Lo SPAZIO nel nome è voluto, e va tenuto. Il percorso canonico di chi
  // sviluppa Filo ne contiene già uno (l'utente si chiama «agenti AI»), quindi
  // lì questo caso girava su un percorso spaziato mentre altrove no: la
  // differenza fra le due macchine tornava a nascondersi qui. Con lo spazio
  // messo apposta, il percorso è spaziato ovunque e il caso vale ovunque.
  const dir = cartellaTemporanea('filo cwd-');
  const home = await page.evaluate(async () => {
    const r = await window.filo?.shellHome?.();
    return r?.cwd || '';
  });
  expect(dir).not.toBe(home); // la temp dir NON deve coincidere con la home
  expect(dir).toContain(' ');  // il caso perde il suo senso se lo spazio sparisce

  // Spostati nella cartella: la riga grigia deve mostrarla. Il percorso va fra
  // VIRGOLETTE: la shell riceve il comando come lo scriverebbe una persona, e
  // senza virgolette si ferma alla prima parola («can't cd to /tmp/con»), non si
  // sposta, e il rosso parla della riga di comando invece che della cartella
  // ricordata. Il test gemello sul contesto del terminale le ha sempre avute.
  await submitInput(page, `/cd "${dir}"`);
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 12_000 });

  // "Esci e rientra": ricarica la dashboard (rilancia l'init, la stessa via che
  // prima resettava la cartella alla home). Ora la cartella salvata va
  // ripristinata: la riga grigia deve mostrare ANCORA la temp dir, non la home.
  await page.reload();
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 8_000 });
  await expect(page.locator('#dashDir')).not.toHaveText(home);
});

test('i colori ANSI vengono resi (niente codici grezzi nel testo visibile)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  // Emette ESC[31m ROSSO ESC[0m -FINE con la sintassi giusta per la shell host.
  const win = process.platform === 'win32';
  const cmd = win
    ? '/echo "$([char]27)[31mROSSO$([char]27)[0m-FINE"'
    : "/printf '\\033[31mROSSO\\033[0m-FINE\\n'";
  await submitInput(page, cmd);

  const out = page.locator('.dash-term-out').last();
  // Il testo visibile è "ROSSO-FINE" CONTIGUO: i codici ESC[..m sono stati
  // rimossi. Se non fossero interpretati, tra ROSSO e -FINE ci sarebbe ESC[0m
  // e questo assert fallirebbe (oltre a comparire "[31m" grezzo).
  await expect(out).toContainText('ROSSO-FINE', { timeout: 12_000 });
  await expect(out).not.toContainText('[31m');
  // "ROSSO" è dentro uno span colorato (colore inline applicato dall'SGR).
  await expect(out.locator('span[style*="color"]')).toContainText('ROSSO');
});

test('evidenziazione live: arancione per i comandi Filo, azzurro per i comandi shell', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  // Comando interno di Filo → arancione (classe is-cmd-filo).
  await typeInput(page, '/help');
  await expect(page.locator('#input')).toHaveClass(/is-cmd-filo/);
  await expect(page.locator('#input')).not.toHaveClass(/is-cmd-shell/);

  // Comando da shell → azzurro (classe is-cmd-shell).
  await typeInput(page, '/ls -la');
  await expect(page.locator('#input')).toHaveClass(/is-cmd-shell/);
  await expect(page.locator('#input')).not.toHaveClass(/is-cmd-filo/);

  // Testo normale → nessuna evidenziazione.
  await typeInput(page, 'che ore sono?');
  await expect(page.locator('#input')).not.toHaveClass(/is-cmd-filo/);
  await expect(page.locator('#input')).not.toHaveClass(/is-cmd-shell/);
});

test('a terminale spento un comando shell non viene eseguito (niente bolla terminale)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  // Con il terminale OFF, `/ls` non è un comando Filo né un sito: in modalità
  // shell sarebbe azzurro, ma qui non deve essere evidenziato come shell.
  await typeInput(page, '/ls -la');
  await expect(page.locator('#input')).not.toHaveClass(/is-cmd-shell/);
});

test('Preferenze: il toggle modalità terminale e la scelta della shell si persistono', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const box = page.locator('#terminalEnabled');
  await expect(box).toBeVisible({ timeout: 8_000 });
  // Default: spento.
  await expect(box).not.toBeChecked();

  // La shell da scegliere è una di quelle che ESISTONO sul sistema dove gira il
  // test: il menu si riscrive per piattaforma (PowerShell e cmd solo su
  // Windows, sh e bash altrove). Chiedere qui una shell di Windows su Linux
  // faceva restare appesa la selezione fino al timeout — e il controllo sulla
  // persistenza spariva proprio dai sistemi non-Windows, cioè da Mac, Linux e
  // dalle routine. La scelta NON è il valore predefinito, altrimenti "si è
  // salvato" e "non è cambiato niente" sarebbero indistinguibili.
  const suWindows = process.platform === 'win32';
  const scelta = suWindows ? 'cmd' : 'bash';
  const predefinita = suWindows ? 'powershell' : 'sh';
  await expect(page.locator('#terminalShell')).toHaveValue(predefinita);
  await expect(page.locator(`#terminalShell option[value="${scelta}"]`)).toHaveCount(1);

  // Attiva + scegli una shell: auto-save (il "Salvato" lampeggia).
  await box.check();
  await page.selectOption('#terminalShell', scelta);
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Persistito: ricaricando, lo stato è conservato.
  await page.reload();
  await expect(page.locator('#terminalEnabled')).toBeChecked({ timeout: 8_000 });
  await expect(page.locator('#terminalShell')).toHaveValue(scelta);
});

// ── La cartella di lavoro dell'ASSISTENTE (#551) ────────────────────────────
//
// Altra cosa dalla shell persistente qui sopra: questa è la cartella dei
// comandi che lancia Filo, e vive fra un messaggio e l'altro. Veniva appuntata
// sul mittente del messaggio, che è un oggetto costruito da capo ogni volta:
// appena l'utente scriveva di nuovo — o CONFERMAVA — Filo era già tornato
// nella cartella personale. Due danni: il file appena elencato «non esiste
// più», e il comando che l'utente approva leggendo «scriverò qui» scrive
// altrove.

const eseguiComando = (page, comando) =>
  page.evaluate((c) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'filo_confirm_action',
      action: { type: 'ESEGUI_COMANDO', comando: c },
    }, (r) => resolve(r));
  }), comando);

test('la cartella dell’assistente vale ancora al messaggio dopo', async ({ openTab }) => {
  const { writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const base = cartellaTemporanea('filo-cwd-assistente-');
  try {
    writeFileSync(join(base, 'bolletta.txt'), 'totale 84,50\n', 'utf8');
    const page = await openTab('filo://dashboard/dashboard.html');
    await setTerminal(page, true);

    const cd = await eseguiComando(page, `cd '${base}'`);
    expect(cd.executed, `il cd non è partito: ${JSON.stringify(cd).slice(0, 300)}`).toBe(true);

    // Messaggio NUOVO: è qui che l'appunto si perdeva.
    const ls = await eseguiComando(page, 'ls');
    expect(
      String(ls.output?.stdout || ''),
      'il comando dopo il «cd» gira altrove: il file appena trovato «non esiste»',
    ).toContain('bolletta.txt');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('un comando confermato scrive nella cartella che Filo aveva mostrato', async ({ app, openTab }) => {
  const { existsSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const base = cartellaTemporanea('filo-conferma-cwd-');
  try {
    const page = await openTab('filo://dashboard/dashboard.html');
    await setTerminal(page, true);

    // Un turno dell'assistente: entra nella cartella e poi propone un comando
    // che modifica — livello 2, quindi si ferma e chiede.
    const [vai, proposta] = await app.evaluate(async (electron, dove) => {
      const wc = electron.webContents.getAllWebContents()
        .find((w) => String(w.getURL() || '').includes('dashboard.html'));
      const mittente = { url: wc ? wc.getURL() : '', tab: null, wc: wc || null };
      const esiti = [];
      for (const comando of [`cd '${dove}'`, 'mkdir prova-di-filo']) {
        esiti.push(await globalThis.SN_EXECUTE_FILO_ACTION(
          { type: 'ESEGUI_COMANDO', comando },
          { sender: mittente },
        ));
      }
      return esiti;
    }, base);
    expect(vai.executed).toBe(true);
    expect(proposta.executed, 'un comando che modifica deve fermarsi a chiedere').toBe(false);
    expect(
      String(proposta.action?._cwd || proposta.describe || ''),
      'il popup deve dire in quale cartella si scriverà',
    ).toContain('filo-conferma-cwd-');

    // La conferma dell'utente è per forza un messaggio nuovo.
    const fatto = await eseguiComando(page, 'mkdir prova-di-filo');
    expect(fatto.executed, `la conferma non ha eseguito: ${JSON.stringify(fatto).slice(0, 300)}`).toBe(true);
    expect(
      existsSync(join(base, 'prova-di-filo')),
      'il comando confermato ha scritto in una cartella diversa da quella mostrata',
    ).toBe(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
    try { rmSync(join(homedir(), 'prova-di-filo'), { recursive: true, force: true }); } catch (_) {}
  }
});

test('se quella cartella sparisce, Filo continua a eseguire e il popup dice dove', async ({ openTab }) => {
  // L'altra metà dello stesso appunto (#551, quarto giro): farlo durare
  // significa portarsi dietro anche una cartella che nel frattempo non c'è
  // più. Lì non fallisce il comando, fallisce la shell prima di leggerlo, e
  // ogni comando dopo cade uguale — compreso quello per andarsene.
  const { rmSync, renameSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const base = cartellaTemporanea('filo-cwd-sparita-');
  const dopo = `${base}-rinominata`;
  try {
    writeFileSync(join(base, 'bolletta.txt'), 'totale 84,50\n', 'utf8');
    const page = await openTab('filo://dashboard/dashboard.html');
    await setTerminal(page, true);
    await eseguiComando(page, `cd '${base}'`);

    // L'utente la rinomina dal gestore dei file mentre chiacchiera con Filo.
    renameSync(base, dopo);

    const eco = await eseguiComando(page, 'echo ciao');
    expect(
      String(eco.output?.stdout || '') + String(eco.output?.stderr || ''),
      'Filo non esegue più niente in questa scheda',
    ).toContain('ciao');
    expect(eco.output?.cwdPersa, 'a chi legge non viene detto che la cartella non c’è più').toBe(true);

    // E il popup di conferma promette la cartella dove il comando finirà
    // davvero, non quella sparita.
    const proposta = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: window.SN_MSG.MSG.FILO_RUN_ACTION,
        action: { type: 'ESEGUI_COMANDO', comando: 'mkdir prova-di-filo' },
      }, (r) => resolve(r));
    }));
    expect(
      String(proposta.action?._cwd || ''),
      'il popup promette una cartella che non esiste più',
    ).not.toContain('filo-cwd-sparita-');
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(dopo, { recursive: true, force: true });
  }
});
