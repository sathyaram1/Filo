// Esplorazione del giro 1 di #814.5: porte alternative al blocco di un modello di sola voce in una funzione di testo.
import { test, expect } from '../../fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function apri(openTab) {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 6_000 });
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 6_000 });
  await page.waitForTimeout(600);
  return page;
}
const cella = (page, t) => page.locator('#modelsGrid > div').filter({ hasText: t });
const salvato = (page, a) => page.evaluate(async (a) => (await window.SN_STORAGE.getSettings()).models[window.SN_CONST.ACTIONS[a]] || '', a);

for (const [nome, uscita] of [['Tab', async (p) => p.keyboard.press('Tab')], ['Invio', async (p) => p.keyboard.press('Enter')], ['clic', async (p) => p.click('#h-models')]]) {
  test(`uscita con ${nome}`, async ({ openTab }) => {
    const page = await apri(openTab);
    const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
    const input = seg.locator('.sn-chain-input');
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially('kokoro', { delay: 20 });
    await uscita(page);
    await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/, { timeout: 4_000 });
    await page.waitForTimeout(1500);
    await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
    expect(await salvato(page, 'EXPLAIN')).not.toContain('kokoro');
  });
}

for (const scritto of ['  kokoro  ', 'KOKORO', 'hexgrad/kokoro-82m']) {
  test(`scritto «${scritto}»`, async ({ openTab }) => {
    const page = await apri(openTab);
    const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
    const input = seg.locator('.sn-chain-input');
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially(scritto, { delay: 15 });
    await page.click('#h-models');
    await page.waitForTimeout(1500);
    const msg = await seg.locator('.sn-chain-msg').textContent().catch(() => null);
    const v = await input.inputValue();
    const s = await salvato(page, 'EXPLAIN');
    const colore = await input.evaluate((e) => getComputedStyle(e).color);
    console.log(JSON.stringify({ scritto, msg, v, s, colore, title: await input.getAttribute('title') }));
  });
}

test('scelto dalla tendina', async ({ openTab }) => {
  const page = await apri(openTab);
  const seg = cella(page, 'Spiega (inline)').locator('.sn-chain-seg').first();
  const input = seg.locator('.sn-chain-input');
  await input.focus();
  const pop = seg.locator('.sn-chain-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  await pop.locator('.sn-select-option[data-value="kokoro"]').click({ force: true });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify({ msg: await seg.locator('.sn-chain-msg').count(), v: await input.inputValue(), s: await salvato(page, 'EXPLAIN') }));
  expect(await salvato(page, 'EXPLAIN')).not.toContain('kokoro');
});

test('secondo segmento e altra funzione di testo', async ({ openTab }) => {
  const page = await apri(openTab);
  const labels = await page.locator('#modelsGrid > div').allTextContents();
  console.log(JSON.stringify(labels.slice(0, 40).map((x) => x.slice(0, 40))));
  const c = cella(page, 'Spiega (inline)');
  const segs = c.locator('.sn-chain-seg');
  const n = await segs.count();
  console.log('segmenti', n);
  if (n > 1) {
    const seg = segs.nth(1);
    const input = seg.locator('.sn-chain-input');
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially('kokoro', { delay: 15 });
    await page.click('#h-models');
    await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/, { timeout: 4_000 });
    await page.waitForTimeout(1500);
    await expect(seg.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
  }
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ openTab }) => {
    const page = await apri(openTab);
    await page.emulateMedia({ colorScheme: tema });
    const c = cella(page, 'Spiega (inline)');
    const seg = c.locator('.sn-chain-seg').first();
    const input = seg.locator('.sn-chain-input');
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially('kokoro', { delay: 15 });
    await page.click('#h-models');
    await expect(seg.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });
    await page.waitForTimeout(1200);
    await c.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/.shots/814.5-${tema}.png` });
    await c.screenshot({ path: `tests/.shots/814.5-${tema}-cella.png` });
  });
}
