// Verifica #1683, giro 1: esplorazione delle cinque porte del pacchetto.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

async function manda(page, testo) {
  const input = page.locator('#input');
  await input.fill(testo);
  await input.press('Enter');
}

const finito = (page) => expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });

for (const shell of ['sh', 'bash']) {
  test(`892.4 ${shell}: righe che non si chiudono finiscono e non si mangiano il comando dopo`, async ({ app }) => {
    const page = await newtabPage(app);
    if (shell === 'bash') {
      await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true, shell: 'bash' } }));
      await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE.getShell()), { timeout: 5_000 }).toBe('bash');
    }
    const casi = [
      "/echo l'altro",
      '/echo "aperto',
      '/echo `date',
      '/echo $(date',
      '/if true; then echo x',
      '/(echo x',
      '/echo a \\',
      '/cat <<FINE',
      '/{ echo x',
      '/for i in 1 2; do echo $i',
    ];
    for (const [i, c] of casi.entries()) {
      await manda(page, c);
      await finito(page);
      const segno = `dopo-${i}-ok`;
      await manda(page, `/echo ${segno}`);
      await expect(page.locator('.dash-term-out').last(), `${c}: il comando dopo ha la sua uscita`).toContainText(segno, { timeout: 12_000 });
      await finito(page);
      const out = await page.locator('.dash-term-out').nth(-2).innerText();
      expect(out, `${c}: l'uscita di prima non si mangia il comando dopo`).not.toContain(segno);
    }
    await page.screenshot({ path: `tests/.shots/1683-8924-${shell}.png` }).catch(() => {});
  });
}

test('892.4: comandi su più righe e cd restano come in un terminale', async ({ app }) => {
  const dir = cartellaTemporanea('filo-1683-cd-');
  const page = await newtabPage(app);
  await manda(page, `/cd "${dir}"`);
  await finito(page);
  await manda(page, '/pwd');
  await expect(page.locator('.dash-term-out').last()).toContainText(path.basename(dir), { timeout: 12_000 });
  await finito(page);
  await manda(page, '/X1683=valore; export X1683');
  await finito(page);
  await manda(page, '/echo "v=$X1683"');
  await expect(page.locator('.dash-term-out').last()).toContainText('v=valore', { timeout: 12_000 });
  await finito(page);
  await manda(page, "/printf '%s\\n' \"l'apostrofo\"");
  await expect(page.locator('.dash-term-out').last()).toContainText("l'apostrofo", { timeout: 12_000 });
  await finito(page);
  await manda(page, '/false');
  await finito(page);
  await manda(page, '/echo "code=$?"');
  await expect(page.locator('.dash-term-out').last()).toContainText('code=1', { timeout: 12_000 });
});

test('892.2: a mano, dopo un cd, con nomi relativi e con la redirezione', async ({ app }) => {
  const dir = cartellaTemporanea('filo-1683-sovr-');
  writeFileSync(path.join(dir, 'bozza.txt'), 'nuovo');
  writeFileSync(path.join(dir, 'lettera.txt'), 'da tenere');
  mkdirSync(path.join(dir, 'Vecchi'));
  writeFileSync(path.join(dir, 'Vecchi', 'lettera.txt'), 'da tenere 2');
  const page = await newtabPage(app);
  await manda(page, `/cd "${dir}"`);
  await finito(page);
  const risultati = {};
  for (const c of ['/cp bozza.txt lettera.txt', '/mv bozza.txt lettera.txt', '/echo x > lettera.txt', '/cp lettera.txt Vecchi', '/cp ~/../../' + dir.replace(/^\//, '') + '/bozza.txt lettera.txt', '/: > lettera.txt']) {
    await manda(page, c);
    let apre = false;
    try { await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 6_000 }); apre = true; } catch (_) {}
    const st = apre ? await confirmState(page) : null;
    risultati[c] = { apre, testo: st ? `${st.title} | ${st.fuori || st.text}` : '' };
    if (apre) await clickConfirm(page, 'cancel');
    await page.locator('#input').fill('');
  }
  console.log('RISULTATI 892.2', JSON.stringify(risultati, null, 1));
  expect(readFileSync(path.join(dir, 'lettera.txt'), 'utf8')).toBe('da tenere');
  expect(readFileSync(path.join(dir, 'Vecchi', 'lettera.txt'), 'utf8')).toBe('da tenere 2');
  for (const [c, r] of Object.entries(risultati)) expect(r.apre, c).toBe(true);
});

test('892.2: proposto da Filo, redirezione e tee sopra un file che c\'è', async ({ app, openTab }) => {
  const dir = cartellaTemporanea('filo-1683-prop-');
  const f = path.join(dir, 'lettera.txt');
  writeFileSync(f, 'da tenere');
  await openTab('filo://newtab/');
  const esegui = (comando) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, {}), { type: 'ESEGUI_COMANDO', comando });
  const r = {};
  for (const c of [`echo x > "${f}"`, `echo x | tee "${f}"`, `cp /dev/null "${f}"`, `truncate -s 0 "${f}"`]) {
    const x = await esegui(c);
    r[c] = { executed: x.executed, needsConfirm: !!x.needsConfirm };
  }
  console.log('RISULTATI proposta', JSON.stringify(r, null, 1));
  expect(readFileSync(f, 'utf8')).toBe('da tenere');
});

test('1561.5: la sola scheda d\'avvio, anche senza colore, «già in ordine»', async ({ app, shell }) => {
  const page = await newtabPage(app);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().map((w) => w._filoTabs).find(Boolean);
    tm.tabs[0].identityColor = null;
    tm.tabs[0]._identitaNota = false;
  });
  await manda(page, '/riordina');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('già in ordine', { timeout: 8_000 });
  await manda(page, '/riordina');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('già in ordine', { timeout: 8_000 });
});

test('635.1: il comando si legge anche con colori personalizzati e in attesa', async ({ app }) => {
  const page = await newtabPage(app);
  await manda(page, '/echo leggibile-1683');
  await expect(page.locator('.dash-term-out').last()).toContainText('leggibile-1683', { timeout: 12_000 });
  for (const t of ['light', 'dark']) {
    await app.evaluate(async (_e, v) => globalThis.__filoHandlers.handleMessage(
      { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: v } },
      { url: 'filo://preferences/preferences.html' },
    ), t);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t, { timeout: 5_000 });
    await page.waitForTimeout(600);
    const st = await page.locator('.dash-term-cmd').last().evaluate((el) => {
      const s = getComputedStyle(el); const p = getComputedStyle(el.querySelector('.dash-term-prompt'));
      return { bg: s.backgroundColor, fg: s.color, prompt: p.color, cls: el.className };
    });
    console.log('STILE', t, JSON.stringify(st));
    await page.screenshot({ path: `tests/.shots/1683-635-${t}.png` }).catch(() => {});
  }
});
