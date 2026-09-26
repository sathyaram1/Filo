// Verifica #677, quinto giro — SONDE (esplorazione, non prove definitive).
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA_GESTIONE = 'filo://manage/manage.html';
const PAGINA_FEEDBACK = 'filo://feedback/feedback.html';

const RIGA = {
  _id: 'fbA', _proiezione: true, _updateTime: 'v1', seq: 900, subSeq: 0,
  name: 'Segnalazione in lavorazione', text: 'Il testo di chi ha segnalato.',
  status: 'unlabeled', statusPublic: 'open', priority: 2,
  clientId: 'tester-1', createdAt: '2026-09-21T10:00:00.000Z',
};

async function admin(page) {
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      if (m && m.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'o@e.invalid' } };
      if (m && m.type === 'feedback_decrypt_fields') return { ok: true, list: m.list };
      if (m && m.type === 'feedback_update') return { ok: true };
      return orig(m);
    };
  });
}

test('SONDA C — pagina feedback: la lettura fallita si ricompra a ogni gesto', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__n = 0;
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(riga))];
    window.SN_FEEDBACK.getMany = async () => { window.__n += 1; throw new Error('Failed to fetch'); };
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 15_000 });
  const primo = await page.evaluate(() => window.__n);

  await page.locator('#search').fill('abc');
  await page.waitForTimeout(1200);
  const dopoRicerca = await page.evaluate(() => window.__n);

  await page.locator('[data-tab="queue"]').click();
  await page.locator('[data-tab="inbox"]').click();
  await page.waitForTimeout(1200);
  const dopoSezioni = await page.evaluate(() => window.__n);

  console.log('SONDA C → letture:', { primo, dopoRicerca, dopoSezioni });
  expect(dopoSezioni).toBe(primo);
});

test('SONDA D — pagina feedback: un dettaglio che non torna lo dice, come la gemella', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.SN_FEEDBACK.list = async () => [JSON.parse(JSON.stringify(riga))];
    window.SN_FEEDBACK.getMany = async () => [];   // il documento non torna
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData([JSON.parse(JSON.stringify(riga))]);
  }, RIGA);

  const card = page.locator('.fb-card[data-id="fbA"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const testo = await card.textContent();
  console.log('SONDA D → la scheda dice:', JSON.stringify(testo).slice(0, 500));
  await page.screenshot({ path: 'tests/.shots/677-giro5-sondaD.png', fullPage: true });
  expect(testo).toMatch(/non è arrivat|Riprova/);
});

test('SONDA E — senza la chiave le sezioni sparisc*ono e la pagina ricompra tutto insieme', async ({ openTab }) => {
  const page = await openTab(PAGINA_FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_FEEDBACK, null, { timeout: 20_000 });
  await admin(page);
  const quanti = await page.evaluate(async () => {
    const righe = [];
    for (let i = 0; i < 40; i += 1) {
      righe.push({
        _id: `x${i}`, _proiezione: true, seq: 1000 + i, subSeq: 0,
        name: `Segnalazione ${i}`, text: `testo ${i}`,
        // Stato CIFRATO: è quello che vede una macchina senza la chiave privata.
        status: 'FENC1:abcdef', statusPublic: 'open',
        clientId: 't', createdAt: `2026-09-${(i % 28) + 1}T10:00:00.000Z`,
      });
    }
    window.__chiesti = [];
    window.SN_FEEDBACK.list = async () => JSON.parse(JSON.stringify(righe));
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__chiesti.push(...ids);
      return ids.map((id) => {
        const r = righe.find((x) => x._id === id);
        const { _proiezione, ...resto } = r;
        return { ...resto, notes: 'report', images: [], files: [] };
      });
    };
    window.__fbTest.setAdmin(true, { email: 'o@e.invalid' });
    window.__fbTest.setData(JSON.parse(JSON.stringify(righe)));
    await new Promise((r) => setTimeout(r, 1500));
    return { chiesti: window.__chiesti.length, sezioni: !document.getElementById('tabs').hidden };
  });
  console.log('SONDA E →', JSON.stringify(quanti));
  expect(quanti.chiesti).toBeLessThan(40);
});

test('SONDA G — Gestione: col resto non arrivato le forme non dicono «audit non fatto»', async ({ openTab }) => {
  const page = await openTab(PAGINA_GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK, null, { timeout: 25_000 });
  await admin(page);
  await page.evaluate((riga) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [],
      getMany: async () => [],
      getDettagli: async () => { throw new Error('Failed to fetch'); },
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ ...JSON.parse(JSON.stringify(riga)), status: 'working' }]);
  }, RIGA);
  await page.locator('[data-tab="queue"]').click().catch(() => {});
  await page.locator('.mg-item[data-id="fbA"]').click();
  await expect(page.locator('#mgRiprovaDettaglio')).toBeVisible({ timeout: 15_000 });
  const forme = await page.evaluate(() => Array.from(document.querySelectorAll('#mgForme .mg-forma'))
    .map((b) => ({ livello: b.dataset.livello, esito: b.dataset.esito, titolo: b.title })));
  console.log('SONDA G → forme:', JSON.stringify(forme));
  await page.screenshot({ path: 'tests/.shots/677-giro5-sondaG.png' });
  expect(forme.length).toBeGreaterThan(0);
});
