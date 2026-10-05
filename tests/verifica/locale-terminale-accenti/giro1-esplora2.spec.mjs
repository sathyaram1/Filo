// Esplorazione del giro 1: il testo con accenti arriva a cmd uguale a com'è scritto.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { readFileSync, rmSync } from 'node:fs';
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

test('testo con accenti: echo, variabili, percento, contenuto dei file', async ({ openTab }) => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('filo accenti4-');
  const r = {};
  try {
    const page = await openTab('filo://dashboard/dashboard.html');
    await imposta(page, { enabled: true, shell: 'cmd' });
    await expect.poll(() => page.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
    await invia(page, `/cd /d "${dir}"`);
    await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 15_000 });

    r.parentesi = await esegui(page, 'echo [città]', 'S1');
    await esegui(page, 'set NOMEX=perché', 'S2');
    r.variabile = await esegui(page, 'echo [%NOMEX%]', 'S3');
    await esegui(page, 'echo città>c1.txt', 'S4');
    await esegui(page, 'echo città è già > c2.txt', 'S5');
    r.percento = await esegui(page, 'echo 100%è', 'S6');
    r.percento2 = await esegui(page, 'echo %è%', 'S7');
    r.lungo = await esegui(page, `echo ${'è'.repeat(600)}`, 'S8');
    r.type = await esegui(page, 'type c2.txt', 'S9');
    r.misto = await esegui(page, 'echo è %USERNAME% à', 'S10');
    r.c1 = readFileSync(join(dir, 'c1.txt')).toString('hex');
    r.c2 = readFileSync(join(dir, 'c2.txt')).toString('hex');
    await invia(page, '/cd /d %TEMP%');
    console.log(JSON.stringify(r, null, 2));
    expect.soft(r.parentesi).toContain('[città]');
    expect.soft(r.variabile).toContain('[perché]');
    expect.soft(r.c1).toBe(Buffer.from('città\r\n').toString('hex'));
    expect.soft(r.c2).toBe(Buffer.from('città è già \r\n').toString('hex'));
    expect.soft(r.percento).toContain('100%è');
    expect.soft(r.percento2).toContain('%è%');
    expect.soft(r.lungo).toContain('è'.repeat(600));
    expect.soft(r.type).toContain('città è già');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
