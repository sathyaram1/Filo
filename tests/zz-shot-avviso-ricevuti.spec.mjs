// SPEC TEMPORANEO di cattura visiva: l'avviso delle fusioni in cima ai
// Ricevuti. Si rimuove prima della consegna.
import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const MANAGE = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;

test('cattura: avviso in cima ai Ricevuti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, recent: [], ttlMs: 24 * 60 * 60 * 1000 };
      return orig(msg);
    };
  }, {
    pending: [{
      id: '0f7fa95a91b2498c621ea505',
      branch: 'worker/570ca694-4eaf-487f-a95b-920f8db904a5-20260822T172453Z',
      sha: 'f29c8f9d7d5cbcffd5d7d543e2920bcf73e4decd',
      who: 'secaudit · notturna',
      origin: 'routine',
      num: '#444',
      blocks: [{ gate: 'child_process', label: 'Avvia un programma esterno', items: ['const m = /^rgba?\\(([^)]+)\\)$/.exec(v);'], more: 0 }],
      createdAtMs: Date.now() - 5 * 60 * 60 * 1000,
      expiresAtMs: Date.now() + 18 * 60 * 60 * 1000,
      expired: false, used: false, discarded: false,
    }],
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([{
    _id: 'fb-444', text: 'Menu del tasto destro sulle copertine video.', name: 'Menu copertine',
    seq: 444, subSeq: 0, clientId: 'sathya@esempio.it', createdAt: '2026-08-20T10:00:00Z', images: [],
  }, {
    _id: 'fb-471', text: 'Un altro feedback in attesa.', name: 'Altro feedback',
    seq: 471, subSeq: 0, clientId: 'tester@esempio.it', createdAt: '2026-08-24T10:00:00Z', images: [],
  }]));
  const diag = await page.evaluate(async () => {
    const r = await window.filo.message({ type: 'merge_approvals_get' });
    const n = await window.__mgTest.loadMergeApprovals();
    return { n, get: JSON.stringify(r).slice(0, 300), host: document.getElementById('mgMergeApprovals')?.outerHTML?.slice(0, 200) };
  });
  console.log('DIAG', JSON.stringify(diag));
  await expect(page.locator('#mgMergeApprovals .sn-mac')).toBeVisible({ timeout: 8000 });
  mkdirSync('tests/agent/.out', { recursive: true });
  await page.screenshot({ path: 'tests/agent/.out/avviso-ricevuti.png', fullPage: false });
});
