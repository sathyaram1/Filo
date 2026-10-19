// Verifica #869 giro 3, rilievo 1: la home già aperta perde il conto delle pagine quando se ne toglie una: righe doppie
// dopo aver tolto la prima pagina del gruppo in corso, pagine cancellate dalla Sicurezza ancora in vista.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

async function visita(openTab, testServer, nome) {
  const p = await openTab(testServer.html(`<title>${nome}</title><p>${nome}</p>`));
  await p.waitForFunction((n) => document.title === n, nome);
}
// Tornare alla home: la scheda torna visibile e rilegge quello che è arrivato.
async function tornaAllaHome(shell, page) {
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const t = s.tabs.filter((x) => String(x.url).startsWith('filo://newtab')).pop();
    await window.filoShell.tabs.activate(t.id);
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1000);
}
const righe = (page) => page.locator('.dash-pagine .dash-pagine-testo').allTextContents();

test('r1 tolgo col tasto destro la prima pagina del gruppo in corso, poi visito un’altra pagina: una riga sola', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const n of ['alfa', 'beta', 'gamma']) await visita(openTab, testServer, n);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await riga.locator('.dash-pagine-testa').click();
  const alfa = riga.locator('.dash-pagina', { hasText: 'alfa' });
  await alfa.click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(alfa).toHaveCount(0);
  await visita(openTab, testServer, 'delta');
  await tornaAllaHome(shell, page);
  expect(await righe(page)).toEqual(['3 pagine, fra cui delta']);
});

test('r1 tolgo dalla ricerca la prima pagina del gruppo in corso, poi visito un’altra pagina: una riga sola', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const n of ['alfa orche', 'beta', 'gamma']) await visita(openTab, testServer, n);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(3);
  const page = await openTab('filo://newtab/');
  await page.locator('#cercaInput').fill('orche');
  await page.locator('#cercaRisultati .dash-cerca-pagina', { hasText: 'alfa orche' }).click({ button: 'right' });
  await page.locator('.sn-menu').getByText('Togli dal filo', { exact: true }).click();
  await expect(page.locator('.dash-pagine .dash-pagine-testo')).toHaveText(['2 pagine, fra cui gamma']);
  await visita(openTab, testServer, 'delta');
  await tornaAllaHome(shell, page);
  expect(await righe(page)).toEqual(['3 pagine, fra cui delta']);
});

test('r1 con la home aperta cancello le pagine di oggi dalla Sicurezza: tornando alla home non le vedo più', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await home(app);
  for (const n of ['alfa', 'beta']) await visita(openTab, testServer, n);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_IL_FILO.pagine()).length)).toBe(2);
  const page = await openTab('filo://newtab/');
  await expect(page.locator('.dash-pagine .dash-pagine-testo')).toHaveText(['2 pagine, fra cui beta']);
  const sic = await openTab('filo://security/security.html');
  const r = await sic.evaluate(async () => self.chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.FILO_PAGINE_CANCELLA, periodo: 'oggi' }));
  expect(r.ok).toBe(true);
  await visita(openTab, testServer, 'delta');
  await tornaAllaHome(shell, page);
  expect(await righe(page)).toEqual(['1 pagina: delta']);
});
