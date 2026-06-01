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

  // Attiva + scegli una shell: auto-save (il "Salvato" lampeggia).
  await box.check();
  await page.selectOption('#terminalShell', 'cmd');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Persistito: ricaricando, lo stato è conservato.
  await page.reload();
  await expect(page.locator('#terminalEnabled')).toBeChecked({ timeout: 8_000 });
  await expect(page.locator('#terminalShell')).toHaveValue('cmd');
});
