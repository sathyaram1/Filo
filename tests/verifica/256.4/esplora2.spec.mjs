import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-256.4';
const FRASE = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera';
const visibile = (app, w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows().find((x) => x.isVisible()).setSize(w, h); }, [w, h]);
const misura = (ed) => ed.evaluate(() => {
  const mod = document.querySelector('.ed-module[data-type="chat"]');
  const t = mod.querySelector('[data-chat="input"]');
  const T = t.getBoundingClientRect(), S = mod.querySelector('[data-chat="send"]').getBoundingClientRect();
  return `vp=${innerWidth}x${innerHeight} t=${Math.round(T.width)}x${Math.round(T.height)} sh/ch=${t.scrollHeight}/${t.clientHeight} ${t.scrollHeight <= t.clientHeight ? 'INTERA' : 'SCORRE'} ${S.top >= T.bottom - 1 ? 'sotto' : 'accanto'} log=${Math.round(mod.querySelector('[data-chat="log"]').getBoundingClientRect().height)}`;
});

async function apri(app, shell, openTab, w, h, tema) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  if (tema) await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  return { ed, chat, casella: chat.locator('[data-chat="input"]') };
}

test('vuota: suggerimento a varie taglie', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const { ed } = await apri(app, shell, openTab, 1280, 800);
  for (const [w, h] of [[960, 600], [1024, 640], [1280, 720], [1366, 768], [1920, 1040]]) {
    await visibile(app, w, h); await ed.waitForTimeout(400);
    console.log('VUOTA', w, h, await misura(ed));
  }
});

test('battuta a tastiera, a capo con Maiusc+Invio, incolla, ridimensiona con testo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const { ed, casella } = await apri(app, shell, openTab, 1280, 720);
  await casella.click();
  await ed.keyboard.type(FRASE, { delay: 5 });
  console.log('TASTIERA 1280x720', await misura(ed));
  await ed.keyboard.press('Shift+Enter');
  await ed.keyboard.type('grazie');
  console.log('ACAPO 1280x720', await misura(ed), JSON.stringify(await casella.inputValue()));
  for (let i = 0; i < 9; i++) await ed.keyboard.press('Backspace');
  console.log('CANC 1280x720', await misura(ed));
  await visibile(app, 1920, 1040); await ed.waitForTimeout(400);
  console.log('RIDIM 1920x1040', await misura(ed));
  await visibile(app, 1280, 720); await ed.waitForTimeout(400);
  console.log('RIDIM 1280x720', await misura(ed));
  await casella.fill('');
  console.log('SVUOTA', await misura(ed));
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), FRASE);
  await casella.focus();
  await ed.keyboard.press('Control+V');
  await ed.waitForTimeout(100);
  console.log('INCOLLA', await misura(ed), (await casella.inputValue()).length);
  await ed.keyboard.press('Control+A'); await ed.keyboard.press('Delete');
  console.log('SELEZIONA-CANCELLA', await misura(ed));
  await ed.keyboard.press('Control+Z');
  await ed.waitForTimeout(100);
  console.log('ANNULLA', await misura(ed), (await casella.inputValue()).length);
});

for (const [w, h, tema] of [[1280, 720, 'dark'], [1280, 720, 'light'], [1440, 900, 'dark'], [960, 600, 'light']]) {
  test(`aspetto ${w}x${h} ${tema}`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    const { ed, chat, casella } = await apri(app, shell, openTab, w, h, tema);
    mkdirSync(SHOTS, { recursive: true });
    await chat.screenshot({ path: `${SHOTS}/vuota-${w}x${h}-${tema}.png` });
    await casella.fill(FRASE);
    await ed.waitForTimeout(150);
    console.log('ASPETTO', w, h, tema, await misura(ed));
    await chat.screenshot({ path: `${SHOTS}/frase-${w}x${h}-${tema}.png` });
    await ed.screenshot({ path: `${SHOTS}/pagina-${w}x${h}-${tema}.png` });
  });
}
