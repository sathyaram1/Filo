// Preferenze: ogni modifica si salva da sola dopo una breve attesa. In quella
// attesa la conferma «Salvato» parla del salvataggio di PRIMA, e chi lascia la
// pagina perde quello che ha appena scritto. Vale per tutte e tre le sezioni
// che salvano così (stile dell'agente, token estetici, colore delle schede).

import { test, expect } from './fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

async function scrivi(page, id, testo) {
  await page.evaluate(([i, t]) => {
    const el = document.getElementById(i);
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, testo]);
}

test('Preferenze: la conferma si spegne appena arriva una modifica non ancora salvata', async ({ openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  await scrivi(page, 'agentStyleText', 'primo testo');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });

  await scrivi(page, 'agentStyleText', 'secondo testo, non ancora salvato');
  const accesa = await page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show'));
  expect(accesa, 'la conferma resta accesa mentre l\'ultima modifica non è salvata').toBe(false);

  // E poi torna, quando il salvataggio è davvero andato.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 5_000 });
});

test('Preferenze: quello che scrivi resta anche se lasci la pagina subito dopo', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  await scrivi(page, 'agentStyleText', 'scritto un attimo prima di uscire');
  await page.reload();
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });

  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).agentStyle || '');
  expect(salvato, 'uscire dentro l\'attesa del salvataggio butta via l\'ultima modifica')
    .toBe('scritto un attimo prima di uscire');
  await expect(page.locator('#agentStyleText')).toHaveValue('scritto un attimo prima di uscire');
});
