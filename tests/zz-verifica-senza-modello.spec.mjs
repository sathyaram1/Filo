// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
// Nessun modello impostato → ogni funzione si ferma e lo DICE all'utente.
import { test, expect } from './fixtures/electron.mjs';

async function svuotaModelli(openTab) {
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('load');
  await opt.waitForTimeout(2500);
  const chk = opt.locator('#useDefaultModels');
  if (await chk.isChecked()) await chk.click();
  await opt.waitForTimeout(800);
  for (let i = 0; i < 40; i++) {
    const btn = opt.locator('#modelRegistryList .sn-model-row button', { hasText: 'Rimuovi' }).first();
    if (!(await btn.count())) break;
    await btn.click();
    await opt.waitForTimeout(200);
  }
  await opt.waitForTimeout(2500);
  expect(await opt.locator('#modelRegistryList .sn-model-row button', { hasText: 'Rimuovi' }).count()).toBe(0);
  return opt;
}

test('senza modello: la lettura ad alta voce lo dice in Preferenze', async ({ openTab }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.waitForTimeout(2500);
  await pref.locator('#ttsModelPreview').click();
  await pref.waitForTimeout(8000);
  const status = (await pref.locator('#ttsModelPreviewStatus').textContent() || '').trim();
  console.log('PREFERENZE — MESSAGGIO:', JSON.stringify(status));
  expect(status.length, 'un messaggio c e').toBeGreaterThan(10);
  expect(status.toLowerCase()).toContain('modell');
});

test('senza modello: la spiegazione lo dice in pagina', async ({ openTab, testServer }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const page = await testServer.openReady(openTab,
    '<html lang="it"><body style="padding:40px"><p id="t">La fotosintesi clorofilliana trasforma la luce in zuccheri.</p></body></html>');
  await page.locator('#t').click({ clickCount: 3 });
  await page.waitForTimeout(800);
  console.log('SELEZIONE:', await page.evaluate(() => String(getSelection())));
  await page.locator('#t').click({ button: 'right' });
  await page.waitForTimeout(1500);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.sn-popup, [class*="sn-menu"]');
    return m ? m.innerText : '(niente)';
  });
  console.log('MENU:', JSON.stringify(menu));
  await page.locator('text=Spiegazione').first().click();
  await page.waitForTimeout(8000);
  const visto = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.sn-toast')].map((e) => e.innerText).join(' | ');
    const pop = [...document.querySelectorAll('.sn-popup')].map((e) => e.innerText).join(' | ');
    return { t, pop };
  });
  console.log('SPIEGAZIONE — TOAST:', JSON.stringify(visto.t));
  console.log('SPIEGAZIONE — POPUP:', JSON.stringify(visto.pop).slice(0, 500));
  expect((visto.t + ' ' + visto.pop).toLowerCase()).toContain('modell');
});

test('senza modello: la ricerca fra le schede archiviate lo dice', async ({ openTab }) => {
  test.setTimeout(180000);
  await svuotaModelli(openTab);
  const arc = await openTab('filo://archive/archive.html');
  await arc.waitForTimeout(2000);
  await arc.locator('#search').fill('qualcosa');
  await arc.locator('#search').press('Enter');
  await arc.waitForTimeout(6000);
  console.log('ARCHIVIO:', JSON.stringify((await arc.locator('#searchNote').textContent() || '').trim()));
});
