// Verifica #866 giro 2, rilievo 1 — una pagina che riscrive il proprio indirizzo senza aprire niente di nuovo
// (una mappa spostata, un filtro, un articolo scorso) resta UNA pagina visitata, non una per ogni riscrittura.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const eventi = (ud) => { const f = join(ud, 'filo', 'eventi.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []; };

test('una mappa che aggiorna l’indirizzo mentre la sposti resta una pagina visitata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const page = await openTab(testServer.html('<!doctype html><title>Mappa</title><p>mappa</p>'));
  const visite = () => eventi(userData).filter((e) => e.tipo === 'navigazione').length;
  await expect.poll(visite, { timeout: 20_000 }).toBe(1);
  for (let i = 0; i < 20; i++) {
    await page.evaluate((k) => history.replaceState(null, '', location.pathname + '?@41.9,12.' + k + ',15z'), i);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(5000);
  await app.evaluate(() => globalThis.SN_IL_FILO.quandoFermo());
  expect(visite(), 'ogni riscrittura dell’indirizzo è diventata una pagina visitata').toBe(1);
});
