// Esplorazione del giro 1: un comando con accenti lascia lo stato della shell come lo lascerebbe cmd.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test.skip(process.platform !== 'win32', 'cmd esiste solo su Windows');

const imposta = (page, terminal) => page.evaluate((t) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: t } }, (r) => resolve(r));
}), terminal);

const invia = (page, v) => page.evaluate((valore) => {
  const input = document.getElementById('input');
  input.value = valore;
  document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}, v);

async function esegui(page, comando, segno) {
  const prima = await page.locator('.dash-term-out').count();
  await invia(page, `/${comando}`);
  await page.waitForTimeout(1500);
  await invia(page, `/echo ${segno}`);
  await expect(page.locator('.dash-term-out').last()).toContainText(segno, { timeout: 15_000 });
  const tutti = await page.locator('.dash-term-out').allInnerTexts();
  return tutti.slice(prima).join('\n');
}

test('stato della shell dopo un comando con accenti', async ({ openTab }) => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('filo accenti5-');
  mkdirSync(join(dir, 'Attività — 2026'));
  const r = {};
  try {
    const page = await openTab('filo://dashboard/dashboard.html');
    await imposta(page, { enabled: true, shell: 'cmd' });
    await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
    await invia(page, `/cd /d "${dir}"`);
    await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 15_000 });

    await esegui(page, 'set ASCIIX=abc', 'S1');
    r.ascii = await esegui(page, 'echo [%ASCIIX%]', 'S2');
    await esegui(page, 'set NOMEX=perché', 'S3');
    r.accento = await esegui(page, 'echo [%NOMEX%]', 'S4');
    await esegui(page, 'cd "Attività — 2026"', 'S5');
    r.dashDir = await page.locator('#dashDir').innerText();
    r.cd = await esegui(page, 'cd', 'S6');
    await esegui(page, 'echo dentro > "nota è.txt"', 'S7');
    r.dirDentro = await esegui(page, 'dir /b', 'S8');
    await invia(page, '/cd /d %TEMP%');
    await page.waitForTimeout(1000);
    console.log(JSON.stringify(r, null, 2));
    expect.soft(r.ascii).toContain('[abc]');
    expect.soft(r.accento).toContain('[perché]');
    expect.soft(r.cd).toContain(join(dir, 'Attività — 2026'));
    expect.soft(r.dashDir).toBe(join(dir, 'Attività — 2026'));
    expect.soft(r.dirDentro).toContain('nota è.txt');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
