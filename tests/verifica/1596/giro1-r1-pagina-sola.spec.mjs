// Verifica #1596 giro 1, rilievo 1: dopo un rifiuto la pagina si accorcia molto più del necessario.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, stub, paginaGrande, chiedi } from './aiuto.mjs';

test('r1 una pagina sola oltre la finestra, con posto per 20.000 caratteri: il modello ne vede l\'inizio, non solo titolo e indirizzo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(paginaGrande('A'));
  await stub(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] }, { finale: 'RISPOSTA_UNO' }], { margine: 20000 });
  await chiedi(page, `leggimi ${url}`);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText('viste=MARCA_A_DENTRO');
  await expect(bolla).toContainText('ho tenuto solo l\'inizio');
});

test('r1 la pagina sola lasciata fuori, riletta come dice l\'avviso al messaggio dopo, arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(paginaGrande('A'));
  const leggi = { strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] };
  await stub(app, [leggi, { finale: 'RISPOSTA_UNO' }, leggi, { finale: 'RISPOSTA_DUE' }], { margine: 20000 });
  await chiedi(page, `leggimi ${url}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' })).toBeVisible({ timeout: 40_000 });
  await chiedi(page, 'rileggila');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_DUE' });
  await expect(bolla).toBeVisible({ timeout: 40_000 });
  await expect(bolla).toContainText('viste=MARCA_A_DENTRO');
});
