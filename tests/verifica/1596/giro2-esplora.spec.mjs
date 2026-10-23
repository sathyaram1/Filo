// Esplorazione della verifica #1596 giro 2: quanto posto libero usano le pagine dopo un rifiuto.
import { test, expect } from '../../fixtures/electron.mjs';
import { NEWTAB, stub, tre, PIANO_TRE, chiedi } from './aiuto.mjs';

for (const margine of [15000, 30000, 45000, 60000, 75000]) {
  test(`esplora margine ${margine}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    const page = await openTab(NEWTAB);
    await tre(app, testServer);
    await stub(app, PIANO_TRE, { margine });
    await chiedi(page, 'cerca i sentieri delle dolomiti e leggimi le guide');
    const bolla = page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_UNO' });
    await expect(bolla).toBeVisible({ timeout: 40_000 });
    const g = await app.evaluate(() => ({ base: globalThis.__g.base, out: globalThis.__g.out, rifiuti: globalThis.__g.rifiuti, car: globalThis.__g.chiamate.map((c) => c.car), tool: globalThis.__g.chiamate.map((c) => c.messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '').length)) }));
    console.log(`MARGINE ${margine}`, JSON.stringify(g), (await bolla.innerText()).replace(/\s+/g, ' '));
  });
}
