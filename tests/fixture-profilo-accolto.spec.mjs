// La fixture apre Filo su un profilo già accolto (#663.6): una prova della chat che dà a Filo un modello a home
// aperta trova la chat di tutti i giorni, non l'intervista di benvenuto. Chi prova l'accoglienza parte dal profilo
// nuovo con `test.use({ accoglienzaFatta: false })`. Senza il profilo accolto delle prove, la prima è rossa.
import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from './helpers/chatFinta.mjs';
import { test as testRete } from './helpers/reteFinta.mjs';

const RISPOSTA = 'Domani a Bologna piove dalle dieci.';
const statoAccoglienza = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
const inizioBenvenuto = (app) => app.evaluate(() => globalThis.SN_ONBOARDING.WELCOME_MESSAGE.split('.')[0]);

test('un modello messo a home aperta e una domanda subito: risponde la chat, l’intervista non parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  expect((await statoAccoglienza(app)).done, 'il profilo delle prove è già accolto').toBe(true);
  const page = await home(app);
  const benvenuto = await inizioBenvenuto(app);
  try {
    await modelloFinto(app, [{ text: RISPOSTA }]);
    await chiedi(page, 'Che tempo fa domani a Bologna?');
    await expect(page.locator('.dash-bubble-filo', { hasText: RISPOSTA })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-bubble-filo')).toHaveCount(1);
    await expect(page.locator('.dash-bubble-filo', { hasText: benvenuto })).toHaveCount(0);

    // Anche una home aperta dopo, col modello già pronto, è la home di tutti i giorni.
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
    const nuova = app.windows().find((w) => w.url().startsWith('filo://newtab') && w !== page);
    await expect(nuova.locator('#input')).toBeVisible({ timeout: 8_000 });
    await chiedi(nuova, 'E dopodomani?');
    // La scheda nuova ha davanti lo scambio di prima (#869): la risposta nuova è la seconda.
    await expect(nuova.locator('.dash-bubble-filo', { hasText: RISPOSTA })).toHaveCount(2, { timeout: 15_000 });
    await expect(nuova.locator('.dash-bubble-filo', { hasText: benvenuto })).toHaveCount(0);
    const stato = await statoAccoglienza(app);
    expect(stato.done).toBe(true);
    expect(stato.thread, 'l’intervista non ha mai cominciato').toEqual([]);
  } finally {
    await ripristina(app);
  }
});

test.describe(() => {
  test.use({ accoglienzaFatta: false });

  test('chi prova l’accoglienza parte dal profilo nuovo: col modello, la home che si apre si presenta', async ({ app, shell }) => {
    test.setTimeout(60_000);
    expect((await statoAccoglienza(app)).done, 'il profilo è nuovo').toBe(false);
    const page = await home(app);
    const benvenuto = await inizioBenvenuto(app);
    try {
      await modelloFinto(app, [{ text: RISPOSTA }]);
      await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
      await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
      const nuova = app.windows().find((w) => w.url().startsWith('filo://newtab') && w !== page);
      await expect(nuova.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
      await expect(nuova.locator('.dash-bubble-filo').first()).toContainText(benvenuto);
    } finally {
      await ripristina(app);
    }
  });
});

// Anche chi apre Filo con un suo avvio (qui la rete finta delle prove sui siti bloccati) parte già accolto: la home
// aperta dopo il modello è quella che, sul profilo nuovo, saluta di sicuro.
testRete('anche l’avvio della rete finta parte accolto: la home aperta dopo il modello risponde, non saluta', async ({ app, shell }) => {
  testRete.setTimeout(60_000);
  expect((await statoAccoglienza(app)).done, 'il profilo delle prove è già accolto').toBe(true);
  const page = await home(app);
  const benvenuto = await inizioBenvenuto(app);
  try {
    await modelloFinto(app, [{ text: RISPOSTA }]);
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://newtab')).length, { timeout: 10_000 }).toBe(2);
    const nuova = app.windows().find((w) => w.url().startsWith('filo://newtab') && w !== page);
    await expect(nuova.locator('#input')).toBeVisible({ timeout: 8_000 });
    await chiedi(nuova, 'Che tempo fa domani a Bologna?');
    await expect(nuova.locator('.dash-bubble-filo', { hasText: RISPOSTA })).toBeVisible({ timeout: 15_000 });
    await expect(nuova.locator('.dash-bubble-filo', { hasText: benvenuto })).toHaveCount(0);
    expect((await statoAccoglienza(app)).thread, 'l’intervista non ha mai cominciato').toEqual([]);
  } finally {
    await ripristina(app);
  }
});
