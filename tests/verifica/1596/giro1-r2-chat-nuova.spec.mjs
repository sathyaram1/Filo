// Verifica #1596 giro 1, rilievo 2: quando il rifiuto arriva lo stesso, «Riprova» rimanda la stessa richiesta allo
// stesso muro e la chat nuova consigliata dalla frase non ha un tasto.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, stub, tre, PIANO_TRE, chiedi } from './aiuto.mjs';

test('r2 il rifiuto per finestra che arriva lo stesso offre la chat nuova che consiglia, accanto a «Riprova»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await openTab(NEWTAB);
  await tre(app, testServer);
  await stub(app, PIANO_TRE, { rifiuto: 'sempre' });
  await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/chat nuova/, { timeout: 40_000 });
  await expect(bolla.locator('button', { hasText: /chat nuova|nuova chat/i })).toHaveCount(1);
});
