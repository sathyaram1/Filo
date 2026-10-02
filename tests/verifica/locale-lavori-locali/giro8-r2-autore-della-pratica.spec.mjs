// Verifica locale «lavori locali», giro 8, rilievo 2: nella conversazione di una pratica tua o di una sessione la
// prima bolla nomina chi l'ha scritta come la testata, non «Utente» né «segnalazione automatica». Dati finti.
import { test, expect } from './../../fixtures/electron.mjs';

test('pratica dell’owner e di una sessione: la prima bolla dice lo stesso autore della testata', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      return orig(msg);
    };
  });
  const at = Date.parse('2026-10-01T09:00:00Z');
  const base = { status: 'todo', statusPublic: 'open', senderProof: 'admin', localOnly: { by: 'owner', at }, pipeline: { skipped: 'local_proven' }, createdAt: '2026-10-01T09:00:00Z', images: [], notes: '' };
  const mia = { ...base, _id: 'own-1', seq: 9811, name: 'Lavoro chiesto dall’owner', text: 'Cosa fa il lavoro.', clientId: 'owner:me' };
  const sessione = { ...base, _id: 'ses-1', seq: 9812, name: 'Lavoro di una sessione', text: 'Cosa fa il lavoro.', clientId: 'local:claude' };
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setTab('local'); }, [mia, sessione]);

  for (const [id, sbagliato] of [['own-1', 'Utente'], ['ses-1', 'segnalazione automatica']]) {
    await page.evaluate((x) => window.__mgTest.openDetail(x), id);
    const prima = page.locator('#mgThread > *').first();
    await expect(prima).toContainText('Cosa fa il lavoro.');
    await page.screenshot({ path: `tests/.shots/giro8-autore-pratica-${id}.png` });
    await expect(prima, id).not.toContainText(sbagliato);
  }
});
