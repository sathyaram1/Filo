// Verifica #869, giro 1, rilievo 2: le pagine tolte dal filo tornano dalla ricerca della home (schede chiuse).
import { test, expect } from '../../fixtures/electron.mjs';

const alle = (giorniFa, ore, minuti = 0) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - giorniFa, ore, minuti).toISOString();
};

async function semina(app, eventi) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = dati.map((x) => E.crea(E.TIPI[x.tipo], x.dati, { ts: x.ts, dispositivo: qui, ...(x.autore ? { autore: x.autore } : {}) }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, eventi);
}

test('r2 una pagina tolta dal filo col tasto destro non torna fra i risultati della ricerca', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'https://www.youtube.com/watch?v=orche';
  await semina(app, [{ tipo: 'NAVIGAZIONE', dati: { url, titolo: 'YouTube: orche' }, ts: alle(0, 0, 30) }]);
  await app.evaluate(async (_e, u) => { await globalThis.SN_ARCHIVED_TABS.archive({ url: u, title: 'YouTube: orche', closedAt: new Date().toISOString() }); }, url);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const orche = riga.locator('.dash-pagina', { hasText: 'YouTube: orche' });
  await orche.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(orche).toHaveCount(0);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
  await expect(page.locator('#cercaRisultati .dash-cerca-pagina')).toHaveCount(0);
});

test('r2 le pagine di oggi cancellate dalla pagina Sicurezza non tornano fra i risultati della ricerca nel filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'https://www.youtube.com/watch?v=orche2';
  await semina(app, [{ tipo: 'NAVIGAZIONE', dati: { url, titolo: 'YouTube: orche' }, ts: new Date(Date.now() - 600_000).toISOString() }]);
  await app.evaluate(async (_e, u) => { await globalThis.SN_ARCHIVED_TABS.archive({ url: u, title: 'YouTube: orche', closedAt: new Date().toISOString() }); }, url);
  const page = await openTab('filo://newtab/');
  const n = await page.evaluate(async () => (await self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_PAGINE_CANCELLA, periodo: 'oggi' })));
  expect(n.ok).toBe(true);
  expect(n.n).toBeGreaterThan(0);
  await page.locator('#cercaInput').fill('orche');
  await expect(page.locator('#cercaRisultati .dash-cerca-niente')).toBeVisible();
});
