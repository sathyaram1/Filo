// Esplorazione del verificatore (#1159): interruttore «Lavori server» e scheda che aspetta il PC.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function stub(page, initial = {}) {
  await page.evaluate((init) => {
    window.__automation = Object.assign({
      enabled: false, autoApprove: { owner: true, filo: true, claude: true, user: true },
      proberWhenIdle: true, routinesEnabled: true,
    }, init);
    window.__sets = [];
    window.__failSet = false;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_get') return Object.assign({ ok: true }, window.__automation);
      if (msg && msg.type === 'automation_set') {
        if (window.__failSet) return { ok: false, error: 'rete' };
        const sent = {};
        for (const k of ['enabled', 'proberWhenIdle', 'routinesEnabled', 'lavoriServer']) {
          if (typeof msg[k] === 'boolean') { window.__automation[k] = msg[k]; sent[k] = msg[k]; }
        }
        window.__sets.push(sent);
        return Object.assign({ ok: true }, window.__automation);
      }
      return orig(msg);
    };
  }, initial);
}

const LOCALE = (extra = {}) => Object.assign({
  _id: 'fb-srv-1', text: 'Lavoro sul server', name: 'Lavoro server di prova', seq: 501, subSeq: 0,
  clientId: 'owner@example.com', createdAt: '2026-10-10T10:00:00Z', images: [],
  status: 'working', statusPublic: 'working', branch: 'claude/srv-prova',
  localOnly: { by: 'owner', at: Date.parse('2026-10-10T10:00:00Z') }, fiducia: 'fidato',
}, extra);

test('interruttore: spento all inizio, si accende e si spegne, salva nella config', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const sw = page.locator('#mgLavoriServer');
  await expect(page.locator('#mgLavoriServerSwitch')).toBeVisible();
  await expect(page.locator('#mgLavoriServerSwitch')).toContainText('Lavori server');
  await expect(sw).not.toBeChecked();
  await expect(sw).toBeEnabled();
  await page.locator('#mgLavoriServerSwitch .mg-switch-track').click();
  await expect(sw).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__sets)).toEqual([{ lavoriServer: true }]);
  await page.locator('#mgLavoriServerSwitch .mg-switch-track').click();
  await expect(sw).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__sets)).toEqual([{ lavoriServer: true }, { lavoriServer: false }]);
  await page.locator('#mgLavoriServerBlock').screenshot({ path: 'tests/.shots/v1159-switch.png' });
  await page.locator('#panel-automation').screenshot({ path: 'tests/.shots/v1159-automazioni.png' });
  // salvataggio fallito: torna indietro e lo dice
  await page.evaluate(() => { window.__failSet = true; });
  await page.locator('#mgLavoriServerSwitch .mg-switch-track').click();
  await expect(sw).not.toBeChecked();
  await expect(page.locator('#mgLavoriServerMsg')).toContainText('NON');
  // non admin: non si tocca
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await expect(sw).toBeDisabled();
});

test('acceso nella config: lo switch lo mostra e la scheda segue le routine', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page, { lavoriServer: true });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fb) => window.__mgTest.setData([fb]), LOCALE());
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await expect(page.locator('#mgLavoriServer')).toBeChecked();
  await page.locator('.mg-tab[data-tab="local"]').click();
  const card = page.locator('.mg-item').first();
  await expect(card).toBeVisible();
  const t1 = await card.innerText();
  await page.screenshot({ path: 'tests/.shots/v1159-locali-acceso.png' });
  // spento: la scheda torna alla sessione locale
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.locator('#mgLavoriServerSwitch .mg-switch-track').click();
  await page.locator('.mg-tab[data-tab="local"]').click();
  const t2 = await page.locator('.mg-item').first().innerText();
  console.log('ACCESO:', JSON.stringify(t1));
  console.log('SPENTO:', JSON.stringify(t2));
  expect(t2).toContain('sessione locale');
  expect(t1).not.toContain('sessione locale');
});

test('passato dalla verifica: «aspetta il PC»', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page, { lavoriServer: true });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fb) => window.__mgTest.setData([fb]), LOCALE({ status: 'revision_security', statusPublic: 'revision', attesa: 'fusione_server' }));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  for (const tab of ['local', 'queue']) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
    const n = await page.locator('.mg-item').count();
    console.log(tab, 'schede', n, n ? JSON.stringify(await page.locator('.mg-item').first().innerText()) : '');
  }
  await page.locator('.mg-tab[data-tab="local"]').click();
  await expect(page.locator('.mg-attesa-server').first()).toContainText('aspetta il PC');
  await page.screenshot({ path: 'tests/.shots/v1159-attesa-pc.png' });
  await page.locator('.mg-item').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v1159-attesa-pc-dettaglio.png' });
  console.log('DETTAGLIO:', JSON.stringify((await page.locator('body').innerText()).slice(0, 3000)));
});
