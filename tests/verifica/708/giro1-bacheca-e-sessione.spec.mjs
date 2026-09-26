// Verifica #708, giro 1 — le due cose che l'utente vede davvero dietro i rossi
// della suite: la bacheca che resta sulla rotella quando una rilettura da capo
// fallisce, e la sessione che spariva da sola dove il sistema non sa cifrare.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';

const SHIPPED = {
  _id: 'fb-verifica-708',
  name: 'Miglioramento gia in pagina',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 708, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

async function ready(page) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_CHAT_ERRORS,
    null,
    { timeout: 15_000 },
  );
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

// La porta che la suite in GitHub apriva senza volerlo: lì la rete c'è, quindi
// il primo giro riesce e le schede sono in pagina. Il guasto del giro dopo
// veniva ingoiato e la pagina restava a girare per sempre.
test('con le schede gia in pagina, una rilettura da capo fallita non lascia la rotella', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  await page.evaluate((shipped) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setList(() => Promise.resolve([shipped]));
  }, SHIPPED);
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('.bd-card')).toHaveCount(1);

  await page.evaluate(() => {
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  });
  await page.evaluate(() => window.__boardTest.reload());

  // L'utente vede un errore con la via d'uscita, non una rotella e non il vuoto.
  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('#bdRetry')).toBeVisible();
  await expect(page.locator('#bdLoading')).toBeHidden();
  await expect(page.locator('#bdEmpty')).toBeHidden();
  // E la frase è in italiano, non il messaggio grezzo dell'eccezione.
  await expect(page.locator('#bdError')).not.toContainText('Failed to fetch');
});

// Riprovare due volte di fila mentre la rete è ancora giù: il tasto si spegne
// durante il tentativo, ma deve tornare premibile a ogni guasto — altrimenti
// bastava un secondo tentativo per restare chiusi fuori.
test('Riprova resta premibile anche dopo due tentativi falliti di fila', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  await page.evaluate((shipped) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    window.__boardTest.setList(() => Promise.resolve([shipped]));
  }, SHIPPED);
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('.bd-card')).toHaveCount(1);

  await page.evaluate(() => {
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  });
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('#bdRetry')).toBeEnabled();

  await page.locator('#bdRetry').click();
  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('#bdRetry')).toBeEnabled();
  await expect(page.locator('#bdLoading')).toBeHidden();

  await page.locator('#bdRetry').click();
  await expect(page.locator('#bdError')).toBeVisible();
  await expect(page.locator('#bdRetry')).toBeEnabled();

  // Rete tornata: il terzo tentativo riporta i miglioramenti.
  await page.evaluate((shipped) => {
    window.__boardTest.setList(() => Promise.resolve([shipped]));
  }, SHIPPED);
  await page.locator('#bdRetry').click();
  await expect(page.locator('#bdError')).toBeHidden();
  await expect(page.locator('.bd-card')).toHaveCount(1);
});
