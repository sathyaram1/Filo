// Verifica #2662 giro 1: la frase di un cambio nella cronologia della home e nel segno della bolla tiene i valori non
// di Filo nel riquadro, anche con testi insoliti, annulli, ricarica e tasto destro.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const STRANO = 'Tono » secco «x» <img src=x onerror="window.__rotto=1"> 😀';

const pezzi = (loc) => loc.evaluate((el) => {
  const fuori = [];
  const dentro = [];
  const giro = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) fuori.push(c.textContent);
      else if (c.classList && c.classList.contains('dash-altrui')) dentro.push(c.textContent);
      else giro(c);
    }
  };
  giro(el);
  return { fuori: fuori.join(''), dentro, img: !!el.querySelector('img'), rotto: !!window.__rotto };
});

const vociPagina = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return (globalThis.SN_VOCI_PAGINA || []).flatMap((f) => { try { return f(el) || []; } catch (_) { return []; } })
    .map((v) => v.label).filter(Boolean);
}, sel);

test('cronologia: stile scritto con » e HTML, annullo, ricarica, tema scuro', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STRANO);
  const riga = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(riga).toBeVisible({ timeout: 10_000 });
  const p = await pezzi(riga.locator('.dash-cambio-testo'));
  console.log('RIGA', JSON.stringify(p));
  expect(p.dentro.join('')).toContain('Tono » secco');
  expect(p.fuori).not.toContain('secco');
  expect(p.img).toBe(false);
  expect(p.rotto).toBe(false);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v2662-riga.png' });
  console.log('MENU RIGA', JSON.stringify(await vociPagina(page, '.dash-cambio:last-of-type .dash-cambio-testo')));

  await riga.hover();
  await riga.locator('.dash-cambio-annulla').click();
  await expect(riga.locator('.dash-cambio-stato')).toHaveText('annullato', { timeout: 10_000 });
  const pa = await pezzi(riga.locator('.dash-cambio-testo'));
  console.log('RIGA ANNULLATA', JSON.stringify(pa));
  expect(pa.dentro.join('')).toContain('Tono » secco');
  const rimesso = page.locator('.dash-cambio', { hasText: 'rimesso com' }).last();
  await expect(rimesso).toBeVisible({ timeout: 10_000 });
  const pr = await pezzi(rimesso.locator('.dash-cambio-testo'));
  console.log('RIMESSO', JSON.stringify(pr));
  expect(pr.dentro.join('')).toContain('Tono » secco');

  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await page.reload();
  const dopo = page.locator('.dash-cambio', { hasText: 'stile dell' }).first();
  await expect(dopo).toBeVisible({ timeout: 10_000 });
  const pd = await pezzi(dopo.locator('.dash-cambio-testo'));
  console.log('RICARICATA', JSON.stringify(pd));
  expect(pd.dentro.join('')).toContain('Tono » secco');
  await dopo.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v2662-riga-scuro.png' });
});

test('cronologia: tanti cambi insieme e timer rinominato', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({
    agentStyle: 'Primo » stile', theme: 'dark', zoom: 120, sound: false, language: 'en',
  }));
  const riga = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(riga).toBeVisible({ timeout: 10_000 });
  console.log('MOLTI', JSON.stringify(await pezzi(riga.locator('.dash-cambio-testo'))));

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST.STORAGE_KEYS || globalThis.SN_CONST;
    const k = C.FILO_TIMERS || 'filo_timers';
    const now = Date.now();
    const t = { id: 'tv1', kind: 'timer', label: 'Pasta » al dente', startedAt: new Date(now).toISOString(), endsAt: new Date(now + 600000).toISOString() };
    await globalThis.SN_STORAGE.setRaw(k, [t]);
    await globalThis.SN_STORAGE.setRaw(k, [{ ...t, label: 'Riso <b>nero</b>' }]);
  }).catch((e) => console.log('TIMER ERR', String(e)));
  const timer = page.locator('.dash-cambio', { hasText: /timer/ }).last();
  if (await timer.count()) {
    await expect(timer).toBeVisible({ timeout: 10_000 });
    console.log('TIMER', JSON.stringify(await pezzi(timer.locator('.dash-cambio-testo'))));
    await timer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tests/.shots/v2662-timer.png' });
  } else console.log('TIMER: nessuna riga');
});

test('segno sulla bolla: valore del modello nel riquadro, annullo dal segno, tasto destro', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  try {
    await livelloAutonomia(app, 'yolo');
    const cambia = { id: 's1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'agentStyle', valore: STRANO }) };
    await modelloFinto(app, [{ text: '', toolCalls: [cambia] }, { text: 'Fatto.' }]);
    await chiedi(page, 'cambia il mio stile');
    await page.locator('.dash-action-btn', { hasText: 'Filo vuole impostare' }).click({ timeout: 10_000 });
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
    const segno = page.locator('.dash-cambi-segno').last();
    await expect(segno).toBeAttached({ timeout: 10_000 });
    console.log('ARIA', await segno.getAttribute('aria-label'));
    await segno.click();
    const frase = page.locator('.dash-cambi-pop .dash-cambi-frase').last();
    await expect(frase).toBeVisible({ timeout: 10_000 });
    const p = await pezzi(frase);
    console.log('SEGNO', JSON.stringify(p));
    expect(p.dentro.join('')).toContain('Tono » secco');
    expect(p.fuori).not.toContain('secco');
    expect(p.img).toBe(false);
    await page.screenshot({ path: 'tests/.shots/v2662-segno.png' });
    console.log('MENU BOLLA', JSON.stringify(await vociPagina(page, '.dash-bubble-cambi')));
    await page.locator('.dash-cambi-pop .dash-cambi-annulla').last().click();
    await expect(page.locator('.dash-cambi-pop .dash-cambi-stato').last()).toHaveText('annullato', { timeout: 10_000 });
    const pa = await pezzi(page.locator('.dash-cambi-pop .dash-cambi-frase').last());
    console.log('SEGNO ANNULLATO', JSON.stringify(pa));
    expect(pa.dentro.join('')).toContain('Tono » secco');
    await page.screenshot({ path: 'tests/.shots/v2662-segno-annullato.png' });
    await page.reload();
    const s2 = page.locator('.dash-cambi-segno').last();
    await expect(s2).toBeAttached({ timeout: 10_000 });
    await s2.click();
    const f2 = page.locator('.dash-cambi-pop .dash-cambi-frase').last();
    await expect(f2).toBeVisible({ timeout: 10_000 });
    console.log('SEGNO RICARICATO', JSON.stringify(await pezzi(f2)));
  } finally {
    await ripristina(app);
  }
});
