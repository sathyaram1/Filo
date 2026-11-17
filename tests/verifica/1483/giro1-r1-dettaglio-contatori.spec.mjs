// Giro 1 di #1483, rilievo 1: «Cosa esce, nel dettaglio» delle Preferenze deve portare al dettaglio dei contatori.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 il link «Cosa esce, nel dettaglio» dei contatori apre la pagina col dettaglio', async ({ openTab }) => {
  const prefs = await openTab('filo://preferences/preferences.html');
  const link = prefs.locator('#contatoriPrivacy');
  await expect(link).toHaveCount(1);
  const href = await link.getAttribute('href');
  const page = await openTab(href);
  await expect(page.locator('#doc-body')).toBeVisible();
  // Il dettaglio dei contatori (cosa conta, voce per voce) sta in «Contatori e percorsi».
  await expect(page.locator('#doc-body h2', { hasText: 'Contatori e percorsi' })).toHaveCount(1);
});
