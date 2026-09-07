// #496 giro 6 — conferma nella pagina vera: la conversazione tagliata al tetto
// sposta la fetta della torta senza che niente lo dica.

import { test, expect } from './fixtures/electron.mjs';
import '../src/shared/feedbackThread.js';
import '../src/shared/verifierRound.js';

const PAGINA = 'filo://manage/manage.html';
const VR = globalThis.SN_VERIFIER_ROUND;
const TH = globalThis.SN_FEEDBACK_THREAD;

// Le note le costruiscono i VERI produttori: roundNote per le verifiche,
// capNotes per il taglio al tetto. Niente testo ricopiato a mano.
const giro = () => VR.roundNote({
  summary: 'Provato: la scheda fa quello che chiedeva la segnalazione. '.repeat(60),
  findings: [{ level: 2, text: 'x'.repeat(3500) }, { level: 1, text: 'y'.repeat(3500) }],
  decision: { fix: [0, 1] },
});
const marker = (i) => `\n--- Aggiornamento dell'agente del ${i + 1}/1/2026 ---\n`;
let INTERE = 'Report di chi ha lavorato.';
for (let i = 0; i < 5; i += 1) INTERE += marker(i) + giro();
INTERE += marker(8) + 'Rifatta la scheda da capo. '.repeat(1550);
INTERE += marker(9) + 'Verifica superata. Provato: adesso funziona.';
const TAGLIATE = TH.capNotes(INTERE);

const doc = (notes) => ([{
  _id: 'a', seq: 1, subSeq: 0, name: 'Lavoro a', text: 't', clientId: 'owner:pino',
  createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'done', notes,
  images: [], priority: 0,
}]);

test('conversazione tagliata: la torta dei giri dice meno del vero', async ({ openTab }) => {
  console.log('[taglio] byte intere:', Buffer.byteLength(INTERE, 'utf8'),
    '· tagliate:', Buffer.byteLength(TAGLIATE, 'utf8'),
    '· il taglio è dichiarato nel testo?', TAGLIATE.includes('i turni più vecchi sono stati rimossi'));

  const page = await openTab(PAGINA);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setWorkerLog([]));

  const leggi = async () => {
    await page.waitForTimeout(250);
    return {
      legenda: await page.locator('#mgStLoopLegend li[data-group]').allTextContents(),
      media: (await page.locator('#mgStLoopAvg').textContent()).trim(),
      esito: await page.locator('#mgStOutcomeLegend li[data-group]').allTextContents(),
      riga: (await page.locator('#mgStRange').textContent()).trim(),
      avvisi: await page.locator('#mgStWarn:visible, #mgStLoopUnreadable:visible, #mgStSparkNote:visible').allTextContents(),
    };
  };

  await page.evaluate((d) => window.__mgTest.setData(d), doc(INTERE));
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const a = await leggi();
  console.log('[taglio] CONVERSAZIONE INTERA   → giri:', JSON.stringify(a.legenda),
    '| esito:', JSON.stringify(a.esito));
  console.log('[taglio]                        → media:', a.media);

  await page.evaluate((d) => window.__mgTest.setData(d), doc(TAGLIATE));
  const b = await leggi();
  console.log('[taglio] CONVERSAZIONE TAGLIATA → giri:', JSON.stringify(b.legenda),
    '| esito:', JSON.stringify(b.esito));
  console.log('[taglio]                        → media:', b.media);
  console.log('[taglio]                        → riga sotto i filtri:', b.riga);
  console.log('[taglio]                        → avvisi in pagina:', JSON.stringify(b.avvisi));
  await page.screenshot({ path: 'tests/.shots/496-g6-taglio.png' });
});
