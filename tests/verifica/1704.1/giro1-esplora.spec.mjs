// #1704.1 giro 1 — la segnalazione riaperta mostra ancora titolo e testo: con più azioni nel turno, testo lunghissimo,
// markup nel titolo.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');
const TITOLO = 'Timer muto';
const BREVE = 'Il timer non suona mai quando la scheda è dietro.';

async function passaSopra(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
}

async function conInvioFinto(app, fn) {
  await app.evaluate(() => {
    globalThis.__fbInviati = [];
    globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fbInviati.push(p); return { id: 'fb-1704' }; };
  });
  try {
    await fn();
  } finally {
    await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
    await ripristina(app);
  }
}

async function inviaERiapri(app, page, chiamate, domanda) {
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: '', toolCalls: chiamate }, { text: 'Fatto.' }]);
  await chiedi(page, domanda);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: '✓' }).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__fbInviati.length), { timeout: 10_000 }).toBe(1);
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.reload();
  return home(app);
}

test('cinque azioni nel turno: riaperta, la segnalazione inviata mostra ancora titolo e testo', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await conInvioFinto(app, async () => {
    const timer = (i) => ({ id: `t${i}`, name: 'TIMER', arguments: JSON.stringify({ secondi: 60 * i, etichetta: `Prova ${i}` }) });
    const fb = { id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: BREVE, titolo: TITOLO }) };
    const di = await inviaERiapri(app, page, [timer(1), timer(2), timer(3), timer(4), fb], 'quattro timer e segnala il timer');
    const bolla = di.locator('.dash-bubble-filo').last();
    await expect(bolla).toBeVisible({ timeout: 10_000 });
    await di.waitForTimeout(1500);
    console.log('BOLLE', JSON.stringify(await di.locator('.dash-bubble-filo').evaluateAll((l) => l.map((e) => e.innerHTML.slice(0, 1500)))));
    console.log('ESITI', JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app).map((c) => c.messages.map((m) => m.esiti || null))))));
    const riga = bolla.locator('.dash-activity-row', { hasText: 'Segnalazione inviata' });
    const nota = bolla.locator('.dash-bubble-note').first();
    const dove = (await riga.count()) ? riga.first() : nota;
    await passaSopra(di, dove);
    await expect(fumetto(di)).toBeVisible({ timeout: 3000 });
    await di.screenshot({ path: 'tests/.shots/verifica-1704-cinque.png' });
    expect(await fumetto(di).evaluate((el) => el.textContent), 'il fumetto dice titolo e testo').toContain(BREVE);
  });
});

test('testo oltre i 16.000 caratteri: riaperta, il fumetto dice il testo intero che è partito', async ({ app }) => {
  test.setTimeout(120_000);
  const page = await home(app);
  await conInvioFinto(app, async () => {
    const lungo = `Inizio.\n${'Il suono non arriva e lo provo ogni mattina. '.repeat(450)}CODA-FINE`;
    const fb = { id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: lungo, titolo: TITOLO }) };
    const di = await inviaERiapri(app, page, [fb], 'segnala il timer');
    const inviato = (await app.evaluate(() => globalThis.__fbInviati))[0];
    expect(inviato.text.endsWith('CODA-FINE'), 'parte il testo intero').toBe(true);
    const riga = di.locator('.dash-activity-row', { hasText: `Segnalazione inviata · ${TITOLO}` }).first();
    await expect(riga).toBeVisible({ timeout: 10_000 });
    await passaSopra(di, riga);
    await expect(fumetto(di)).toBeVisible({ timeout: 3000 });
    const t = await fumetto(di).evaluate((el) => el.textContent);
    expect(t.length, 'il fumetto non è vuoto').toBeGreaterThan(1000);
    expect(t.endsWith('CODA-FINE') || /…|tagliat|non mostr/i.test(t.slice(-200)), 'o il testo è intero o dice che manca la coda').toBe(true);
  });
});

test('markup nel titolo e nel testo: il fumetto lo mostra come testo', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await conInvioFinto(app, async () => {
    const titolo = '<img src=x onerror="window.__xss=1"><b>grassetto</b>';
    const testo = '<script>window.__xss=2</script><i>corsivo</i> & fine';
    const fb = { id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo, titolo }) };
    const di = await inviaERiapri(app, page, [fb], 'segnala il timer');
    const riga = di.locator('.dash-activity-row', { hasText: 'Segnalazione inviata' }).first();
    await expect(riga).toBeVisible({ timeout: 10_000 });
    await passaSopra(di, riga);
    await expect(fumetto(di)).toBeVisible({ timeout: 3000 });
    expect(await fumetto(di).evaluate((el) => el.textContent)).toBe(`${titolo}\n\n${testo}`);
    expect(await di.evaluate(() => window.__xss || 0)).toBe(0);
    expect(await fumetto(di).locator('img, b, i, script').count()).toBe(0);
  });
});
