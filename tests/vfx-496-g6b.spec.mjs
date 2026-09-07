// #496 giro 6 — conferma nella pagina vera: la conversazione tagliata al tetto
// sposta la fetta della torta senza che niente lo dica.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = 'filo://manage/manage.html';
const iso = (g) => new Date(Date.now() - g * 86400000).toISOString();

test('conversazione tagliata: la torta dei giri dice meno del vero', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  // Le note le costruiscono i VERI produttori dentro la pagina: roundNote per
  // le verifiche, capNotes per il taglio al tetto. Niente testo ricopiato.
  const note = await page.evaluate(() => {
    const VR = window.SN_VERIFIER_ROUND;
    const T = window.SN_FEEDBACK_THREAD;
    const giro = () => VR.roundNote({
      summary: 'Provato: la scheda fa quello che chiedeva la segnalazione. '.repeat(60),
      findings: [{ level: 2, text: 'x'.repeat(3500) }, { level: 1, text: 'y'.repeat(3500) }],
      decision: { fix: [0, 1] },
    });
    const marker = (i) => `\n--- Aggiornamento dell'agente del ${i + 1}/1/2026 ---\n`;
    let n = 'Report di chi ha lavorato.';
    for (let i = 0; i < 5; i += 1) n += marker(i) + giro();
    n += marker(8) + 'Rifatta la scheda da capo. '.repeat(1550);
    n += marker(9) + 'Verifica superata. Provato: adesso funziona.';
    return { intere: n, tagliate: T.capNotes(n) };
  });
  console.log('[taglio] byte intere:', note.intere.length, '· tagliate:', note.tagliate.length);
  console.log('[taglio] il taglio è dichiarato nel testo?',
    note.tagliate.includes('i turni più vecchi sono stati rimossi'));

  const fb = (id, seq, notes) => ({
    _id: id, seq, subSeq: 0, name: `Lavoro ${id}`, text: 't', clientId: 'owner:pino',
    createdAt: iso(1), status: 'done', notes, images: [], priority: 0,
  });

  const leggi = async () => {
    await page.waitForTimeout(200);
    return {
      legenda: await page.locator('#mgStLoopLegend li[data-group]').allTextContents(),
      media: (await page.locator('#mgStLoopAvg').textContent()).trim(),
      riga: (await page.locator('#mgStRange').textContent()).trim(),
      avvisi: await page.locator('#mgStWarn:visible, #mgStLoopUnreadable:visible').allTextContents(),
    };
  };

  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setWorkerLog([]));

  await page.evaluate((n) => window.__mgTest.setData([fbSeed(n)]) , note.intere).catch(() => {});
  await page.evaluate((n) => window.__mgTest.setData([{
    _id: 'a', seq: 1, subSeq: 0, name: 'Lavoro a', text: 't', clientId: 'owner:pino',
    createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'done', notes: n,
    images: [], priority: 0,
  }]), note.intere);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const intere = await leggi();
  console.log('[taglio] CON LA CONVERSAZIONE INTERA  → legenda:', JSON.stringify(intere.legenda));
  console.log('[taglio]                              → media:', intere.media);

  await page.evaluate((n) => window.__mgTest.setData([{
    _id: 'a', seq: 1, subSeq: 0, name: 'Lavoro a', text: 't', clientId: 'owner:pino',
    createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'done', notes: n,
    images: [], priority: 0,
  }]), note.tagliate);
  const tagliate = await leggi();
  console.log('[taglio] CON LA CONVERSAZIONE TAGLIATA → legenda:', JSON.stringify(tagliate.legenda));
  console.log('[taglio]                              → media:', tagliate.media);
  console.log('[taglio]                              → riga sotto i filtri:', tagliate.riga);
  console.log('[taglio]                              → avvisi in pagina:', JSON.stringify(tagliate.avvisi));
  await page.screenshot({ path: 'tests/.shots/496-g6-taglio.png' });
});
