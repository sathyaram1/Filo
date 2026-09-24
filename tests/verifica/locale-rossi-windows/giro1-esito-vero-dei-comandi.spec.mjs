// Verifica locale, giro 1 (ramo claude/rossi-windows): l'esito di un comando che arriva all'assistente e al
// terminale della dashboard è quello vero, anche quando a decidere è un programma esterno.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const WIN = process.platform === 'win32';

const eseguiComando = (page, comando) =>
  page.evaluate((c) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'filo_confirm_action',
      action: { type: 'ESEGUI_COMANDO', comando: c },
    }, (r) => resolve(r));
  }), comando);

async function setTerminal(page, enabled) {
  await page.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: v } } },
      (r) => resolve(r),
    );
  }), enabled);
}

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

// Scrive il comando nella barra della dashboard e aspetta che la bolla finisca; torna la bolla.
async function nelTerminale(page, comando) {
  const prima = await page.locator('.dash-term-out').count();
  await page.evaluate((v) => {
    const input = document.getElementById('input');
    input.value = v;
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, comando);
  await expect(page.locator('.dash-term-out')).toHaveCount(prima + 1, { timeout: 12_000 });
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 30_000 });
  return page.locator('.dash-term-out').last();
}

function preparaCartella() {
  const base = cartellaTemporanea('filo-esito-vero-');
  writeFileSync(join(base, 'esiste.txt'), 'contenuto-7731\n', 'utf8');
  // Uno script il cui ultimo passo è un programma esterno che esce con 3, senza un exit esplicito.
  if (WIN) writeFileSync(join(base, 'costruisci.ps1'), 'Write-Output "costruisco"\ncmd /c exit 3\n', 'utf8');
  else writeFileSync(join(base, 'costruisci.sh'), 'echo costruisco\nsh -c "exit 3"\n', 'utf8');
  return base;
}

async function assistenteIn(openTab, base) {
  const page = await openTab('filo://dashboard/dashboard.html');
  await setTerminal(page, true);
  const vai = await eseguiComando(page, `cd '${base}'`);
  expect(vai.executed, `il cd iniziale non è partito: ${JSON.stringify(vai).slice(0, 300)}`).toBe(true);
  return page;
}

test('all\'assistente un comando fallito arriva fallito, e uno riuscito col commento in coda gira', async ({ openTab }) => {
  const base = preparaCartella();
  try {
    const page = await assistenteIn(openTab, base);

    const manca = await eseguiComando(page, WIN ? 'Get-Content nonesiste-7731.txt' : 'cat nonesiste-7731.txt');
    expect(manca.executed, 'un file che non c\'è risulta letto').toBe(false);
    expect(manca.output.code).not.toBe(0);

    const cartella = await eseguiComando(page, WIN ? 'Set-Location (Join-Path $HOME "cartella-che-non-c-e-7731")'
      : 'cd "$HOME/cartella-che-non-c-e-7731"');
    expect(cartella.executed, 'una cartella sbagliata risulta raggiunta').toBe(false);

    const lancio = await eseguiComando(page, WIN ? 'throw "rotto-7731"' : 'sh -c "exit 9"');
    expect(lancio.executed, 'un errore lanciato risulta riuscito').toBe(false);

    const commento = await eseguiComando(page, WIN ? 'Get-Content esiste.txt # leggo il file' : 'cat esiste.txt # leggo il file');
    expect(commento.executed, `col commento in coda: ${JSON.stringify(commento.output).slice(0, 300)}`).toBe(true);
    expect(String(commento.output.stdout)).toContain('contenuto-7731');

    expect((await eseguiComando(page, 'exit 3')).output.code, 'exit N').toBe(3);
    expect((await eseguiComando(page, 'node -e "process.exit(7)"')).output.code, 'codice di un programma esterno').toBe(7);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('all\'assistente il codice d\'uscita di un programma esterno vale anche con le redirezioni e dentro uno script', async ({ openTab }) => {
  const base = preparaCartella();
  try {
    const page = await assistenteIn(openTab, base);

    // Riuscito, ma scrive su stderr: con 2>&1 (la forma che un modello scrive spesso) resta riuscito.
    const avviso = await eseguiComando(page, 'node -e "console.error(\'avviso-7731\')" 2>&1');
    expect(avviso.output.code, `un programma riuscito risulta fallito: ${JSON.stringify(avviso.output).slice(0, 300)}`).toBe(0);
    expect(avviso.executed).toBe(true);

    // Lo script finisce con un programma esterno uscito con 3: l'esito è 3, non riuscito.
    const script = await eseguiComando(page, WIN ? '.\\costruisci.ps1' : 'sh ./costruisci.sh');
    expect(String(script.output.stdout)).toContain('costruisco');
    expect(script.output.code, 'lo script è fallito ma risulta riuscito').toBe(3);
    expect(script.executed).toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('nel terminale della dashboard un comando fallito lo dice, uno riuscito col commento no', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  const manca = await nelTerminale(page, WIN ? '/Get-Content nonesiste-7731.txt' : '/cat nonesiste-7731.txt');
  await expect(manca.locator('.dash-term-exit'), 'un file che non c\'è risulta letto').toContainText('codice');

  const ok = await nelTerminale(page, WIN ? '/Write-Output riuscito-7731 # commento' : '/echo riuscito-7731 # commento');
  await expect(ok).toContainText('riuscito-7731');
  await expect(ok.locator('.dash-term-exit')).toHaveCount(0);
});

test('nel terminale della dashboard un programma riuscito che scrive su stderr resta riuscito con 2>&1', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  const avviso = await nelTerminale(page, '/node -e "console.error(\'avviso-7731\')" 2>&1');
  await expect(avviso).toContainText('avviso-7731');
  await expect(avviso.locator('.dash-term-exit'), 'un programma riuscito risulta fallito').toHaveCount(0);
});
