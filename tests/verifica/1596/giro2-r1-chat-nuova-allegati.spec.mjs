// Verifica #1596 giro 2, rilievo 1: «Chat nuova» sull'errore di finestra piena rimette solo il testo del messaggio.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, stub, tre, PIANO_TRE, chiedi } from './aiuto.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('r1 un messaggio con un\'immagine incollata: «Chat nuova» lo rimette con l\'immagine, non con una frase al suo posto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'sempre' });
  await page.evaluate((b64) => {
    const bin = atob(b64);
    const blob = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/png' });
    document.getElementById('input').closest('form').dispatchEvent(new CustomEvent('filo:paste-image', { detail: { blob }, cancelable: true }));
  }, PNG);
  await expect(page.locator('.dash-img-preview')).toHaveCount(1);
  await chiedi(page, 'cerca sentieri come quello della foto e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/chat nuova/, { timeout: 40_000 });
  await bolla.locator('button', { hasText: 'Chat nuova' }).click();
  await expect(page.locator('#input')).toHaveValue('cerca sentieri come quello della foto e leggimi le guide');
  await expect(page.locator('.dash-img-preview')).toHaveCount(1);
});

test('r1 quello che l\'utente aveva cominciato a scrivere sotto l\'errore non sparisce cliccando «Chat nuova»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'sempre' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/chat nuova/, { timeout: 40_000 });
  await page.locator('#input').fill('solo la prima guida');
  await bolla.locator('button', { hasText: 'Chat nuova' }).click();
  await expect(page.locator('#input')).toHaveValue(/solo la prima guida/);
});
