// Verifica #2096 giro 3, rilievo 1: in Preferenze una tendina dentro la sua etichetta dà a «Chiedi a Filo» il nome con
// le scelte attaccate («Durata della cache Come i predefiniti5 minutiUn'ora»), e un'etichetta lunga esce tagliata a metà
// parola. Il nome giusto è quello che la pagina scrive sopra il controllo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const CASI = [
  { id: 'contestoCache', nome: 'Durata della cache' },
  { id: 'traduzioneNascoste', nome: 'Sezioni chiuse' },
];

for (const { id, nome } of CASI) {
  test(`r1 Preferenze: «Chiedi a Filo» sulla tendina ${id} la chiama «${nome}»`, async ({ openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://preferences/preferences.html');
    await expect(page.locator(`#${id}`)).toBeAttached({ timeout: 10_000 });
    const tendina = page.locator(`#${id}`).locator('xpath=..').locator('.sn-select-button').first();
    await tendina.scrollIntoViewIfNeeded();
    await tendina.click({ button: 'right' });
    await menuDi(page).voce('Chiedi a Filo').first().click();
    const campo = page.locator('.sn-sidebar-input textarea');
    await expect(campo).toBeVisible({ timeout: 8_000 });
    await expect(campo).toHaveValue(`Sull'impostazione «${nome}»: `);
  });
}

test('r1 Preferenze: il nome di una voce con l’etichetta lunga non resta tagliato a metà parola', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#correttoreRiscritte')).toBeAttached({ timeout: 10_000 });
  await page.locator('#correttoreRiscritte').scrollIntoViewIfNeeded();
  await page.locator('#correttoreRiscritte').click({ button: 'right' });
  await menuDi(page).voce('Chiedi a Filo').first().click();
  const campo = page.locator('.sn-sidebar-input textarea');
  await expect(campo).toBeVisible({ timeout: 8_000 });
  await expect(campo).not.toHaveValue(/\s\S{1,3}…»/);
});
