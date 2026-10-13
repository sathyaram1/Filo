// Verifica #667.7 giro 1: un modello respinto in Opzioni lascia la sua spiegazione, coi passi dell'utente e le loro varianti.
import { test, expect } from '../../fixtures/electron.mjs';

const OPTIONS = 'filo://options/options.html';

const cella = (page, etichetta) => page.locator('#modelsGrid > div')
  .filter({ has: page.locator(':scope > label', { hasText: etichetta }) });

async function apri(openTab) {
  const page = await openTab(OPTIONS);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.evaluate(() => {
    window.__echi = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === window.SN_MSG.MSG.SETTINGS_UPDATED) window.__echi++; });
  });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });
  await expect.poll(() => page.evaluate(() => window.__echi), { timeout: 8_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  return page;
}

const echi = (page) => page.evaluate(() => window.__echi);

async function respingi(page, seg, valore, tasto = 'Tab') {
  const prima = await echi(page);
  const input = seg.locator('.sn-chain-input');
  await input.click();
  await input.press('ControlOrMeta+a');
  await input.pressSequentially(valore, { delay: 20 });
  await page.keyboard.press(tasto);
  await expect(seg.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });
  await expect.poll(() => echi(page), { timeout: 8_000 }).toBeGreaterThan(prima);
  await page.waitForTimeout(800);
}

test('passi della segnalazione, scritti a tastiera: la spiegazione resta dopo il salvataggio', async ({ openTab }) => {
  const page = await apri(openTab);
  const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await respingi(page, seg, 'kokoro');
  await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
  await expect(seg.locator('.sn-chain-input')).not.toHaveValue('kokoro');
  await page.screenshot({ path: 'tests/.shots/667.7-rifiuto.png' });
});

test('con Invio al posto di Tab, uguale', async ({ openTab }) => {
  const page = await apri(openTab);
  const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await respingi(page, seg, 'kokoro', 'Enter');
  await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
});

test('nel segmento di riserva aggiunto col +', async ({ openTab }) => {
  const page = await apri(openTab);
  const c = cella(page, 'Spiega (inline)');
  const quanti = await c.locator('.sn-chain-seg').count();
  await c.locator('.sn-chain-add').click();
  await expect(c.locator('.sn-chain-seg')).toHaveCount(quanti + 1);
  await page.waitForTimeout(800);
  const seg = c.locator('.sn-chain-seg').nth(quanti);
  await respingi(page, seg, 'kokoro');
  await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
});

test('respinto due volte di fila, la spiegazione c\'è anche la seconda', async ({ openTab }) => {
  const page = await apri(openTab);
  const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await respingi(page, seg, 'kokoro');
  await respingi(page, seg, 'kokoro');
  await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
});

test('un cambio di impostazioni qualunque fatto altrove non porta via la spiegazione', async ({ openTab }) => {
  const altrove = await openTab('filo://newtab/');
  const page = await apri(openTab);
  const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await respingi(page, seg, 'kokoro');
  const prima = await echi(page);
  await altrove.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { monthlyLimitEur: 9 },
  }));
  await expect.poll(() => echi(page), { timeout: 8_000 }).toBeGreaterThan(prima);
  await page.waitForTimeout(500);
  await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
});

test('ogni funzione della griglia tiene la spiegazione del suo rifiuto', async ({ openTab }) => {
  const page = await apri(openTab);
  const n = await page.locator('#modelsGrid > div').count();
  const senza = [];
  for (let k = 0; k < n; k++) {
    const c = page.locator('#modelsGrid > div').nth(k);
    const nome = (await c.locator(':scope > label').first().textContent().catch(() => '')) || `#${k}`;
    const seg = c.locator('.sn-chain-seg').first();
    const input = seg.locator('.sn-chain-input');
    if (!(await input.count())) continue;
    await input.focus();
    const pop = seg.locator('.sn-chain-pop');
    await expect(pop).toBeVisible({ timeout: 4_000 });
    const cattivo = await pop.locator('.sn-select-option.sn-disabled').first().getAttribute('data-value').catch(() => null);
    await page.keyboard.press('Escape');
    if (!cattivo) continue;
    const prima = await echi(page);
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially(cattivo, { delay: 10 });
    await page.keyboard.press('Tab');
    const vista = await seg.locator('.sn-chain-msg').isVisible({ timeout: 3_000 }).catch(() => false);
    await expect.poll(() => echi(page), { timeout: 8_000 }).toBeGreaterThan(prima).catch(() => {});
    await page.waitForTimeout(600);
    const resta = await seg.locator('.sn-chain-msg').isVisible().catch(() => false);
    if (!(vista && resta)) senza.push(`${nome.trim()} (${cattivo}): vista=${vista} resta=${resta}`);
  }
  expect(senza, 'funzioni dove la spiegazione manca o sparisce').toEqual([]);
});
