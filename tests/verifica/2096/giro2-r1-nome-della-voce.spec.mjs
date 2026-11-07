// Verifica #2096 giro 2, rilievo 1: il tasto destro delle pagine delle impostazioni chiama la voce col nome sbagliato.
// Su una tendina sotto un titolo prende l'elenco delle sue scelte; su un elenco di Altro il nome interno.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function chiediAFilo(page, bersaglio) {
  await bersaglio.click({ button: 'right', force: true });
  await menuDi(page).voce('Chiedi a Filo').first().click();
  const campo = page.locator('.sn-sidebar-input textarea');
  await expect(campo).toBeVisible({ timeout: 8_000 });
  return campo;
}

test('r1 Preferenze: «Chiedi a Filo» sulla tendina del tema la chiama «Tema»', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toBeAttached({ timeout: 10_000 });
  const tendina = page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first();
  const campo = await chiediAFilo(page, tendina);
  await expect(campo).toHaveValue("Sull'impostazione «Tema»: ");
});

test('r1 Altro: «Chiedi a Filo» sull\'elenco dei siti bloccati non usa il nome interno', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://options/altro.html');
  const elenco = page.locator('#blocklist');
  await expect(elenco).toBeAttached({ timeout: 10_000 });
  const titolo = (await page.locator('#h-blocklist').textContent()).trim();
  const campo = await chiediAFilo(page, elenco);
  await expect(campo).toHaveValue(`Sull'impostazione «${titolo}»: `);
});
