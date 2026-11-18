// #2577: una chiamata della prova che arriva mentre il main lavora per la chat ne eredita anche la provenienza.
import { test, expect } from '../../fixtures/electron.mjs';

const occupaIn = (app, ms) => app.evaluate((_e, durata) => {
  setTimeout(() => globalThis.SN_REGISTRO_CAMBI.con({ via: 'chat', dove: 'prova-verifica' }, () => {
    const fine = Date.now() + durata;
    while (Date.now() < fine) { /* occupato */ }
  }), 50);
  return true;
}, ms);

test('r1 un cambio di impostazioni fatto dalla prova mentre il main lavora per la chat non diventa un cambio della chat', async ({ app }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'light' }); });
  await app.evaluate(async () => { await globalThis.SN_REGISTRO_CAMBI.attesa(); });
  await occupaIn(app, 1500);
  await new Promise((r) => setTimeout(r, 300));
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await expect.poll(async () => {
    const lista = await app.evaluate(async () => globalThis.SN_REGISTRO_CAMBI.lista());
    const ev = lista.filter((e) => e.cambi.some((c) => c.chiave === 'theme' && c.dopo === 'dark')).pop();
    return ev ? `${ev.via}${ev.dove ? ' ' + ev.dove : ''}` : 'nessuno';
  }, { timeout: 5_000 }).toBe('filo');
});

test('esplorazione: senza la fixture, una lettura a stringa durante il lavoro incognito ne eredita il contesto', async ({ app }) => {
  await app.evaluate((_e, durata) => {
    setTimeout(() => globalThis.__filoStorage.runIncognito(() => {
      const fine = Date.now() + durata;
      while (Date.now() < fine) { /* occupato */ }
    }), 50);
    return true;
  }, 1500);
  await new Promise((r) => setTimeout(r, 300));
  expect(await app.evaluate('globalThis.__filoStorage.inIncognito()')).toBe(true);
});
