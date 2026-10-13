// Esplorazione del verificatore, giro 5 di #1159: si toglie prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';

const OUT = 'C:/Users/agenti AI/Desktop/Filo/report/ruoli-invertiti-stato/ondata2/tmp-1159/g5/shots';
const MANAGE = 'filo://manage/manage.html';
const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const base = { clientId: 'tester@example.com', createdAt: '2026-09-11T08:00:00Z', images: [], subSeq: 0 };
const DOMANDA = { ...base, _id: 'fb-dom', seq: 804, name: 'Ha domande', text: 'd', status: 'design', statusReason: 'clarify', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nQuale colore preferisci?' };
const LOCALE = {
  ...base, _id: 'fb-loc', seq: 806, name: 'Va finito in locale', text: 'f', clientId: 'local:claude',
  status: 'design', statusReason: 'locale', pipeline: giudici('aligned'),
  notes: "Report.\n\n--- Aggiornamento dell'agente del 06/10/26, 03:58 ---\nRichiede lavoro locale. Dal contenitore la rete è chiusa: lancia lo script sulla tua macchina.",
};
const FIDATO = { ...LOCALE, _id: 'fb-loc2', seq: 807, name: 'Va finito sul server, fidato', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' };
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-10-10T08:00:00Z') };
const SRV = {
  _id: 'srv-1', name: 'Il token del server si rinnova', text: 'Lavoro sul server.', seq: 1200, subSeq: 0,
  status: 'revision_security', statusPublic: 'open', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato',
  localOnly: SEGNO, attesa: 'fusione_server', branch: 'worker/srv-1-20261012T090000Z', createdAt: '2026-10-10T07:00:00Z', images: [],
};
const SRV2 = { ...SRV, _id: 'srv-2', seq: 1201, name: 'Riallineato dopo il conflitto', status: 'revision_capability', attesa: '' };
const AZZURRO = 'rgb(38, 201, 252)';
const colore = (loc) => loc.evaluate((el) => getComputedStyle(el).color);

async function apri(page, feedbacks) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__auto = { enabled: false, autoApprove: {}, proberWhenIdle: true, routinesEnabled: true, lavoriServer: false };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'automation_get') return Object.assign({ ok: true }, window.__auto);
      if (t === 'automation_set') { if (typeof msg.lavoriServer === 'boolean') window.__auto.lavoriServer = msg.lavoriServer; return Object.assign({ ok: true }, window.__auto); }
      if (t === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

test('il caso di main con il nome del pulsante del ramo: il resto regge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [LOCALE, DOMANDA]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), LOCALE._id);
  const rombo = page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]');
  await expect(rombo).toHaveClass(/mg-forma--locale/);
  await rombo.click();
  const corpo = page.locator('#mgSideBody');
  await expect(corpo).toContainText('lancia lo script sulla tua macchina');
  await expect(corpo).toContainText('Lavoro server');
  await expect(corpo).not.toContainText('Nessuna segnalazione');
  const bottoni = await page.locator('#mgDetail button, .mg-detail button').allInnerTexts().catch(() => []);
  console.log('BOTTONI', JSON.stringify(bottoni.filter((b) => /Lavoro|coda/i.test(b))));
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(200);
    expect(await colore(rombo)).toBe(AZZURRO);
    await page.screenshot({ path: `${OUT}/ricevuti-locale-${tema}.png` });
  }
  await page.evaluate((fb) => window.__mgTest.setData([fb]), { ...LOCALE, status: 'todo', statusReason: null });
  await expect(page.locator('.mg-segno-fermata[data-forma="rombo"]')).toHaveCount(0);
});

test('aspetto: Automazioni, Lavori server e Ricevuti in chiaro e in scuro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [SRV, SRV2, FIDATO, LOCALE]);
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.locator('.mg-tab[data-tab="automation"]').click();
    await page.evaluate(() => window.__mgTest.loadAutoMode());
    await page.evaluate(() => document.getElementById('mgLavoriServerBlock').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
    await expect(page.locator('#mgLavoriServer')).not.toBeChecked();
    await page.screenshot({ path: `${OUT}/automazioni-${tema}.png` });
    await page.evaluate(() => window.__mgTest.setTab('local'));
    await page.waitForTimeout(400);
    await expect(page.locator('.mg-item[data-id="srv-1"] .mg-attesa-server')).toHaveText('Pronto: aspetta il PC');
    await page.screenshot({ path: `${OUT}/lavori-server-${tema}.png` });
    await page.evaluate(() => window.__mgTest.openDetail('srv-1'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/dettaglio-srv-${tema}.png` });
    await page.evaluate(() => window.__mgTest.setTab('inbox'));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__mgTest.openDetail('fb-loc2'));
    await page.waitForTimeout(400);
    console.log('STATO', tema, await page.locator('.mg-item[data-id="fb-loc2"]').innerText().catch(() => '?'));
    await page.screenshot({ path: `${OUT}/ricevuti-fidato-${tema}.png` });
  }
});
