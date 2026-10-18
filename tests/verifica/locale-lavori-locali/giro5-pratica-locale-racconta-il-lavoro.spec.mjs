// Verifica locale «lavori locali», giro 5: la porta del giro 4 (la pratica di un lavoro locale non racconta il lavoro)
// riprovata in Gestione. Presa in carico, la scheda e il dettaglio dicono che la lavora una sessione locale, senza le
// frasi delle routine, e la conversazione porta i giri. Dati finti; screenshot in chiaro e scuro in tests/.shots/.
import { test, expect } from './../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('un lavoro locale in lavorazione: niente frasi delle routine, e i giri della verifica nella conversazione', async ({ openTab }) => {
  const VL = await imp('scripts/verify-local.mjs');
  await imp('src/shared/feedbackThread.js');
  const TH = globalThis.SN_FEEDBACK_THREAD;
  const critica = 'Provato tutto.\n[2i] Due lavori fusi in locale sono ancora nella bacheca pubblica: passi.\n[0i] Un rifiuto propone strade che rifiutano.';
  const n1 = VL.notaDelGiro({ rounds: [] }, { branch: 'claude/prova', sha: 'aaaaaaaa1' });
  const n2 = VL.notaDelGiro({ rounds: [{ critique: critica, outcome: 'corretto' }] }, { branch: 'claude/prova', sha: 'bbbbbbbb2' });
  const notes = TH.mergeModelReport(TH.mergeModelReport('', n1), n2);

  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });
  const presa = new Date(Date.now() - 3 * 3600e3).toISOString();
  const pratica = {
    _id: 'loc-9', seq: 9910, subSeq: 0, name: 'Chiusura del lavoro: sessioni locali senza giudici', text: 'Lavoro locale.',
    status: 'working', statusPublic: 'open', workingSince: presa, clientId: 'local:claude', senderProof: 'admin',
    localOnly: { by: 'local:claude', at: Date.parse(presa) }, pipeline: { skipped: 'local_proven' },
    createdAt: '2026-10-01T11:29:20Z', images: [], notes,
  };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('local'); }, [pratica]);
  const scheda = page.locator('.mg-item');
  await expect(scheda).toHaveCount(1);
  await expect(scheda).toContainText('In lavorazione in una sessione locale');
  await expect(scheda).not.toContainText('rientra in coda');
  await page.evaluate((id) => window.__mgTest.openDetail(id), 'loc-9');
  const dettaglio = page.locator('#mgDetail');
  await expect(dettaglio).toBeVisible();
  await expect(dettaglio).not.toContainText('rientra in coda');
  await expect(dettaglio).not.toContainText('Nessuna istanza');
  await expect(dettaglio).toContainText('giro 2: avviata');
  await expect(dettaglio).toContainText('livello 2: Due lavori fusi in locale');

  for (const tema of ['light', 'dark']) {
    await page.evaluate(async (t) => {
      await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } });
    }, tema);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/giro5-pratica-locale-${tema}.png` });
  }
});
