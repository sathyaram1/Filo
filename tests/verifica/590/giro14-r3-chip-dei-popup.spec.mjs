// Giro 14, rilievo 3: «Apri» sulla chip dei popup apre il sito della lista senza dirlo.
import { test, expect, lista, schede, apri, contaAvvisi } from './helpers/banco.mjs';

test('«Apri» sulla chip di un popup verso il sito della lista non lo apre in silenzio', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO DELLA LISTA</h1>');
  const pagina = rete.pagina('sito.test', '/', `<button id="b" onclick="window.open(${JSON.stringify(bersaglio).replace(/"/g, '&quot;')}, 'p', 'width=400,height=300')">pop</button>`);
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#b');
  const chip = shell.locator('.popup-chip').first();
  await expect(chip).toBeVisible({ timeout: 6000 });
  await chip.locator('button', { hasText: 'Apri' }).click();
  await shell.waitForTimeout(2000);
  expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
  expect((await avvisi()).length).toBeGreaterThan(0);
});
