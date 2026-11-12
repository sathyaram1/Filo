// Verifica #2378, giro 1: campi con lo stesso nome (una risposta per ogni messaggio di una discussione).
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:24px;font-family:sans-serif">
  <div><p>Messaggio di Anna</p><form><textarea name="commento" style="width:300px;height:50px"></textarea><button>Rispondi</button></form></div>
  <div><p>Messaggio di Bruno</p><form><textarea name="commento" style="width:300px;height:50px"></textarea><button>Rispondi</button></form></div>
  <div><p>Messaggio di Carla</p><form><textarea name="commento" style="width:300px;height:50px"></textarea><button>Rispondi</button></form></div>
</body></html>`;

const caselle = (page) => page.locator('textarea').evaluateAll((l) => l.map((t) => t.value));

test('r1 la risposta a Carla, dopo la ricarica, torna nella casella di Carla e non in quella di Anna', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('textarea').nth(2).click();
  await page.keyboard.type('Carla, hai ragione tu');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => caselle(page).then((v) => v.join('|')), { timeout: 8000 }).not.toBe('||');
  expect(await caselle(page)).toEqual(['', '', 'Carla, hai ragione tu']);
});

const NASCOSTE = `<!doctype html><html><body style="margin:0;padding:24px;font-family:sans-serif">
  <div><p>Messaggio di Anna</p><button class="apri">Rispondi</button><form hidden><textarea name="commento" style="width:300px;height:50px"></textarea></form></div>
  <div><p>Messaggio di Bruno</p><button class="apri">Rispondi</button><form hidden><textarea name="commento" style="width:300px;height:50px"></textarea></form></div>
  <script>for (const b of document.querySelectorAll('.apri')) b.onclick = () => { b.nextElementSibling.hidden = false; };</script>
</body></html>`;

test('r1 con le caselle di risposta che si aprono dal tasto, la risposta a Bruno torna riaprendo la sua casella', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, NASCOSTE);
  await page.locator('.apri').nth(1).click();
  await page.locator('textarea').nth(1).click();
  await page.keyboard.type('Bruno, ci vediamo domani');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.waitForTimeout(800);
  await page.locator('.apri').nth(1).click();
  await expect.poll(() => page.locator('textarea').nth(1).inputValue(), { timeout: 5000 }).toBe('Bruno, ci vediamo domani');
  expect(await page.locator('textarea').nth(0).inputValue()).toBe('');
});
