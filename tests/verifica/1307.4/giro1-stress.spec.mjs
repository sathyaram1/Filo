// Verifica #1307.4, giro 1: esplorazione delle strade intorno alla visita che arriva con la home davanti.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { oggiFa } from '../../helpers/istanti.mjs';

async function semina(app, pagine) {
  await app.evaluate(async (_e, dati) => {
    const E = globalThis.SN_FILO_EVENTI;
    const qui = await globalThis.SN_IL_FILO.dispositivo();
    const ev = dati.map((p) => E.crea(E.TIPI.NAVIGAZIONE, { url: p.url, titolo: p.titolo }, { ts: p.ts, dispositivo: qui }));
    await globalThis.SN_IL_FILO.importa(ev.map(E.riga).join(''));
  }, pagine);
}
const tre = () => ['orche che cacciano', 'balene', 'delfini'].map((titolo, i) => ({ url: `https://esempio.test/${i}`, titolo, ts: oggiFa(0.05 - i * 0.01, 1000 * (i + 1)) }));

for (let k = 0; k < 4; k++) {
  test(`togli e visita insieme: il conto finale tiene la visita nuova (${k})`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await home(app);
    await semina(app, tre());
    const page = await openTab('filo://newtab/');
    const riga = page.locator('.dash-pagine').last();
    await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui delfini');
    await riga.locator('.dash-pagine-testa').click();
    await riga.locator('.dash-pagina', { hasText: 'balene' }).click({ button: 'right' });
    const voce = menuDi(page).locator('.sn-menu').getByText('Togli dal filo', { exact: true });
    await voce.waitFor();
    const [, id] = await Promise.all([
      voce.click(),
      app.evaluate(async (_e, ms) => { await new Promise((r) => setTimeout(r, ms)); return (await globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/1', titolo: 'balene' })).id; }, k * 40),
    ]);
    await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui balene');
    await expect(riga.locator(`.dash-pagina[data-id="${id}"]`)).toHaveCount(1);
    await expect(page.locator('.dash-pagine')).toHaveCount(1);
  });
}

test('due home aperte: anche quella dietro prende la visita senza tornare davanti', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const dietro = await home(app);
  await semina(app, tre());
  const davanti = await openTab('filo://newtab/');
  await expect(davanti.locator('.dash-pagine-testo').last()).toHaveText('3 pagine, fra cui delfini');
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/9', titolo: 'squali' }));
  await expect(davanti.locator('.dash-pagine-testo').last()).toHaveText('4 pagine, fra cui squali');
  await expect.poll(() => dietro.evaluate(() => [...document.querySelectorAll('.dash-pagine-testo')].map((n) => n.textContent).pop())).toBe('4 pagine, fra cui squali');
});

test('tolto tutto il gruppo, la visita che arriva dopo ha la sua riga', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await home(app);
  await semina(app, tre());
  const page = await openTab('filo://newtab/');
  const riga = page.locator('.dash-pagine').last();
  await expect(riga.locator('.dash-pagine-testo')).toHaveText('3 pagine, fra cui delfini');
  await riga.locator('.dash-pagine-testa').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu').getByText('Togli queste 3 pagine dal filo', { exact: true }).click();
  const ok = page.getByRole('button', { name: 'Togli', exact: true });
  await ok.click();
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/9', titolo: 'squali' }));
  await expect(page.locator('.dash-pagine .dash-pagine-testo')).toHaveText(['1 pagina: squali']);
});

test('home vuota mentre Filo risponde: la pagina caricata nel frattempo entra nel filo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Eccomi.', ritardoMs: 2500 }]);
  await expect(page.locator('.dash-pagine')).toHaveCount(0);
  await chiedi(page, 'ciao');
  await page.waitForTimeout(400);
  await app.evaluate(() => globalThis.SN_IL_FILO.registraVisita({ url: 'https://esempio.test/orche', titolo: 'orche' }));
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Eccomi.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-pagine .dash-pagine-testo')).toHaveText(['1 pagina: orche'], { timeout: 8000 });
});
