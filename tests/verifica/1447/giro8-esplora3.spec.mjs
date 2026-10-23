// Esplorazione del giro 8 di verifica #1447: la pagina del correttore con parole imparate, chiaro e scuro.
import { test } from '../../fixtures/electron.mjs';

for (const tema of ['light', 'dark']) {
  test(`esplora: pagina del correttore ${tema}`, async ({ app, openTab }) => {
    await app.evaluate(async (_e, tema) => {
      await globalThis.SN_STORAGE.updateSettings({ theme: tema });
      await globalThis.chrome.storage.local.set({
        sn_personal_dict: ['ciuruglio', 'iPhone', 'Sathya'],
        sn_autocorrect: { 'x es': 'per esempio', cmq: 'comunque' },
        sn_correttore_imparato: { accettate: {}, annullate: {}, riscritte: {}, rifiutate: ['marco', 'perchè'] },
      });
    }, tema);
    const p = await openTab('filo://spellcheck/spellcheck.html');
    await p.waitForTimeout(1500);
    await p.setViewportSize({ width: 1100, height: 1400 }).catch(() => {});
    await p.screenshot({ path: `tests/.shots/1447-g8-correttore-${tema}.png`, fullPage: true });
  });
}
