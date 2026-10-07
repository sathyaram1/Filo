// Verifica locale, giro 2 (ramo claude/rossi-windows): un programma riuscito che scrive su stderr resta riuscito
// anche quando il comando redirige lo stderr (2>&1 e simili), all'assistente e nel terminale della dashboard.

import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const WIN = process.platform === 'win32';
const AVVISO = 'node -e "console.error(\'avviso-7732\')"';
const REDIREZIONI = WIN ? ['2>&1', '2>$null', '2> err.txt', '*>&1'] : ['2>&1', '2>/dev/null', '2> err.txt'];

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

async function nelTerminale(page, comando) {
  const bolle = page.locator('.dash-bubble.dash-term');
  const prima = await bolle.count();
  await page.evaluate((v) => {
    const input = document.getElementById('input');
    input.value = v;
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, comando);
  await expect(bolle).toHaveCount(prima + 1, { timeout: 12_000 });
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 30_000 });
  return bolle.last();
}

test('all\'assistente un programma riuscito con lo stderr rediretto arriva riuscito', async ({ openTab }) => {
  const base = cartellaTemporanea('filo-stderr-');
  execFileSync('git', ['init', '-q'], { cwd: base });
  try {
    const page = await openTab('filo://dashboard/dashboard.html');
    await setTerminal(page, true);
    expect((await eseguiComando(page, `cd '${base}'`)).executed).toBe(true);

    const ramo = await eseguiComando(page, 'git checkout -b prova-7732 2>&1');
    expect(ramo.executed, `git checkout -b con 2>&1: ${JSON.stringify(ramo.output).slice(0, 300)}`).toBe(true);
    expect(String((await eseguiComando(page, 'git branch --show-current')).output.stdout)).toContain('prova-7732');

    for (const r of REDIREZIONI) {
      const esito = await eseguiComando(page, `${AVVISO} ${r}`);
      expect(esito.executed, `con ${r}: ${JSON.stringify(esito.output).slice(0, 300)}`).toBe(true);
    }

    const fallito = await eseguiComando(page, 'node -e "console.error(\'x\'); process.exit(4)" 2>&1');
    expect(fallito.output.code, 'un programma fallito con lo stderr rediretto').toBe(4);
    const manca = await eseguiComando(page, `${WIN ? 'Get-Content' : 'cat'} manca-7732.txt 2>&1`);
    expect(manca.executed, 'un file che non c\'è, con lo stderr rediretto').toBe(false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('nel terminale della dashboard un programma riuscito con lo stderr rediretto non mostra un codice', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await setTerminal(page, true);
  await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

  const ok = await nelTerminale(page, `/${AVVISO} 2>&1`);
  await expect(ok).toContainText('avviso-7732');
  await expect(ok.locator('.dash-term-exit')).toHaveCount(0);

  const manca = await nelTerminale(page, `/${WIN ? 'Get-Content' : 'cat'} manca-7732.txt 2>&1`);
  await expect(manca.locator('.dash-term-exit')).toContainText('codice');
});
