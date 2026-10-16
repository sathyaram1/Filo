// Verifica #845 giro 1, rilievo 1: la pagina salvata che la risposta nomina senza copiarne il titolo alla lettera
// resta senza bottone. Rosse finché il riferimento cliccabile dipende dalla citazione esatta del titolo.
import { test, expect } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const semina = (app, pagine) => app.evaluate(async (_e, p) => {
  await globalThis.chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.SAVED_PAGES]: p });
}, pagine);

async function provaRisposta(app, rete, risposta) {
  const url = rete.pagina('cucina.test', '/ricette/carbonara', '<title>c</title>');
  await semina(app, [{ id: 'g1', url, title: 'Spaghetti alla carbonara: la ricetta originale | Cucina Facile', favicon: '', thumbnail: '', savedAt: '2026-10-03T10:00:00.000Z', category: null }]);
  await modelloFinto(app, [
    { toolCalls: [{ id: 's1', name: 'CERCA_SALVATE', arguments: JSON.stringify({ cerca: 'ricetta' }) }] },
    { text: risposta },
  ]);
  const page = await home(app);
  await chiedi(page, 'dov\'era quella ricetta che avevo salvato?');
  await expect(page.locator('.dash-bubble').filter({ hasText: 'salvata il 3 ottobre' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-salvata-btn')).toHaveCount(1, { timeout: 5_000 });
}

test('r1 titolo accorciato prima dei due punti: la pagina nominata diventa comunque un bottone', async ({ app, rete }) => {
  test.setTimeout(60_000);
  try { await provaRisposta(app, rete, 'È «Spaghetti alla carbonara», salvata il 3 ottobre.'); } finally { await ripristina(app); }
});

test('r1 una sola pagina trovata e descritta a parole: il bottone c\'è', async ({ app, rete }) => {
  test.setTimeout(60_000);
  try { await provaRisposta(app, rete, 'È la ricetta della carbonara di Cucina Facile, salvata il 3 ottobre.'); } finally { await ripristina(app); }
});
