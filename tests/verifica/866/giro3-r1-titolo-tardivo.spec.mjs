// Verifica #866 giro 3, rilievo 1 — la pagina visitata porta il titolo che la pagina mostra, anche quando lo scrive
// dopo il caricamento (le app web) o in due passi dopo un cambio d'indirizzo interno («Caricamento…» → il titolo vero).
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const visite = (ud) => {
  const f = join(ud, 'filo', 'eventi.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)).filter((e) => e.tipo === 'navigazione') : [];
};
// Il titolo di una visita è l'ultimo che il filo dice per lei: quello della pagina come la vede l'utente.
const titoli = (app) => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).map((p) => p.titolo));

test('un titolo scritto dalla pagina dopo il caricamento è quello della visita', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await openTab(testServer.html('<!doctype html><p>app</p><script>setTimeout(()=>{document.title="Posta in arrivo (3)"},700)</script>'));
  await openTab(testServer.html('<!doctype html><title>Caricamento…</title><p>app</p><script>setTimeout(()=>{document.title="Ordine 1234 confermato"},700)</script>'));
  await new Promise((r) => setTimeout(r, 4000));
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect((await titoli(app)).sort()).toEqual(['Ordine 1234 confermato', 'Posta in arrivo (3)']);
});

test('dopo un cambio d’indirizzo interno vale il titolo finale, non quello di passaggio', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const ud = await app.evaluate(() => process.env.FILO_USER_DATA);
  const page = await openTab(testServer.html('<!doctype html><title>Home video</title><p>x</p>'));
  await expect.poll(() => visite(ud).length, { timeout: 20_000 }).toBe(1);
  await page.evaluate(() => {
    history.pushState(null, '', '/video/42');
    document.title = 'Caricamento…';
    setTimeout(() => { document.title = 'Orche al tramonto - Video'; }, 600);
  });
  await new Promise((r) => setTimeout(r, 6000));
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(await titoli(app)).toContain('Orche al tramonto - Video');
  expect(await titoli(app)).not.toContain('Caricamento…');
});
