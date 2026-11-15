// #2229 giro 1: il tasto destro su un «da fare» nella lista offre «Fatto», come su una domanda offre il consiglio.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ora = Date.now();
const RIF = { fb1736: { num: '#1736', priorita: 1, stato: 'design', motivo: 'locale' } };
const DA_FARE = {
  id: 'D-21', numero: 21, stato: 'aperta', priorita: 'importante', fiducia: 'fidato', tipo: 'da_fare', blocca: true, legata: 'fb1736',
  titolo: 'Permessi di Claude Code dal tuo PC', creataIl: ora - 1000, modificataIl: ora - 1000, consiglio: null, conversazione: [],
  problema: 'Apri una sessione sul PC e approva la modifica ai permessi del repo.',
  collegamenti: [{ tipo: 'feedback', id: 'fb1736' }],
  opzioni: [
    { testo: 'L’ho fatto', azione: { tipo: 'riprendi', feedbackId: 'fb1736' } },
    { testo: 'Non serve più', azione: { tipo: 'archivia', feedbackId: 'fb1736' } },
  ],
};

test('r1 il tasto destro su un «da fare» offre «Fatto», e la voce manda la scelta che riprende il lavoro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(([l, r]) => window.__mgTest.setDomande(l, { riferimenti: r }), [[DA_FARE], RIF]);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => {
    window.__domande = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (!/^domand/.test(String(msg && msg.type))) return orig(msg);
      window.__domande.push(msg);
      return { ok: false, error: 'finto' };
    };
  });

  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-21"]').click({ button: 'right' });
  const fatto = page.locator('.mg-ctxmenu .sn-select-option', { hasText: /^Fatto/ });
  await expect(fatto).toHaveCount(1);
  await fatto.click();
  await expect.poll(() => page.evaluate(() => window.__domande.filter((m) => m.type === 'domanda_rispondi').map((m) => [m.id, m.scelta])))
    .toEqual([['D-21', 0]]);
});
