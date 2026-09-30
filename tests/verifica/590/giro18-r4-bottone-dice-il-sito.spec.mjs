// Verifica #590, giro 18, rilievo 4: «Apri comunque» sotto la risposta dice quale sito apre.

import { test, expect, lista } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (url, id) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina' }) });

test('due aperture fermate nello stesso giro: i due «Apri comunque» si distinguono senza passarci sopra', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test', 'xn--mnchen-3ya.de']);
  const a = rete.pagina('blocked.test', '/', '<h1>SITO A</h1>');
  const b = rete.pagina('xn--mnchen-3ya.de', '/', '<h1>SITO B</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(a, 'n1'), naviga(b, 'n2')] }, { text: 'Tutte e due sono fra i siti bloccati.' }]);
  try {
    await chiedi(page, 'apri le due pagine');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Tutte e due' })).toBeVisible({ timeout: 20_000 });
    const bottoni = page.getByRole('button', { name: /Apri comunque/ });
    await expect(bottoni).toHaveCount(2);
    const testi = await bottoni.evaluateAll((bs) => bs.map((x) => x.textContent));
    expect(testi[0]).toContain('blocked.test');
    expect(testi[1]).toContain('münchen.de');
  } finally {
    await ripristina(app);
  }
});
