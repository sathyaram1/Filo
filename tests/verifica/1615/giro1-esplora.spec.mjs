// Verifica #1615 giro 1: le strade della chat sull'account oltre al caso del segnalante.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, modelloFinto, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';
import { googleFinto, risposteFinte, schedeSu, indirizzoDellAccesso, rispondiAlLoopback } from '../../helpers/googleFinto.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const EMAIL = 'chi.accede@prova.test';

async function preparaLogin(app, testServer) {
  const pagina = await googleFinto(app, testServer);
  await risposteFinte(app, EMAIL);
  await app.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8');
    safeStorage.decryptString = (b) => Buffer.from(b).toString('utf8');
  });
  return pagina;
}
const stato = (shell) => shell.evaluate(() => window.filoShell.auth.status());
async function entraDaChat(app, shell, page, pagina) {
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a1', name: 'ACCOUNT', arguments: JSON.stringify({ cosa: 'accedi' }) }] },
    { text: 'Ti ho aperto l\'accesso.' },
  ]);
  await chiedi(page, 'si un accesso più veloce');
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url).toBeTruthy();
  await rispondiAlLoopback(url);
  await expect.poll(async () => (await stato(shell)).signedIn, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => schedeSu(app, pagina).then((s) => s.length), { timeout: 10_000 }).toBe(0);
}

test('cambia account in chat: esci e accedi nello stesso turno lasciano fuori e con l\'accesso aperto', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const pagina = await preparaLogin(app, testServer);
  const page = await home(app);
  await entraDaChat(app, shell, page, pagina);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'e1', name: 'ACCOUNT', arguments: JSON.stringify({ cosa: 'esci' }) },
      { id: 'e2', name: 'ACCOUNT', arguments: JSON.stringify({ cosa: 'accedi' }) },
    ] },
    { text: 'Sei uscito; scegli l\'altro account.' },
  ]);
  await chiedi(page, 'cambia account');
  const url = await indirizzoDellAccesso(app, pagina);
  expect(url, 'dopo l\'uscita si apre l\'accesso').toBeTruthy();
  expect((await stato(shell)).signedIn).toBe(false);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'scegli l\'altro account' })).toBeVisible({ timeout: 10_000 });
  const esiti = JSON.stringify((await chiamateAlModello(app)).at(-1));
  expect(esiti).toContain('Uscito dall');
  expect(esiti).toContain('Aperta in una scheda');
});

test('a Conservativo «esci» chiede l\'OK in chat e, confermato, esce', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const pagina = await preparaLogin(app, testServer);
  const page = await home(app);
  await entraDaChat(app, shell, page, pagina);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { toolCalls: [{ id: 'x1', name: 'ACCOUNT', arguments: JSON.stringify({ cosa: 'esci' }) }] },
    { text: 'Fatto, sei uscito.' },
  ]);
  await chiedi(page, 'esci dal mio account');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect(await confirmText(page)).toMatch(/Uscire dall'account di Filo/);
  expect((await stato(shell)).signedIn).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'verifica-1615-conferma-esci.png') });
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await stato(shell)).signedIn, { timeout: 10_000 }).toBe(false);
});

test('diario in tema scuro dopo un accesso dalla chat', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  const pagina = await preparaLogin(app, testServer);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  const page = await home(app);
  await entraDaChat(app, shell, page, pagina);
  await page.locator('.dash-activity-head').last().click();
  await page.waitForTimeout(400);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'verifica-1615-diario-scuro.png') });
});
