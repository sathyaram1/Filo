// Verifica #2378, giro 1: esplorazione (ricarica immediata, chat senza modulo, sito che si accende tardi).
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const pronta = (page) => page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');

test('ricarica subito dopo l\'ultimo tasto: il testo torna intero', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><textarea name="m" style="width:300px;height:60px"></textarea></body>`);
  await page.locator('textarea').click();
  await page.keyboard.type('scritto e ricaricato di colpo');
  await page.reload();
  await pronta(page);
  await expect.poll(() => page.locator('textarea').inputValue(), { timeout: 8000 }).toBe('scritto e ricaricato di colpo');
});

test('una chat senza modulo: inviato con Invio e svuotato dal sito, alla ricarica il messaggio non torna', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><ul id="lista"></ul>
    <textarea id="chat" placeholder="Scrivi un messaggio" style="width:300px;height:40px"></textarea>
    <script>const t = document.getElementById('chat'); t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault();
      const li = document.createElement('li'); li.textContent = t.value; document.getElementById('lista').append(li); t.value = ''; } });</script></body>`);
  await page.locator('#chat').click();
  await page.keyboard.type('ciao a tutti');
  await page.keyboard.press('Enter');
  await page.reload();
  await pronta(page);
  await page.waitForTimeout(1500);
  expect(await page.locator('#chat').inputValue()).toBe('');
});

test('un sito che accende i suoi script tardi riceve il testo rimesso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px">
    <textarea id="m" name="m" style="width:300px;height:60px"></textarea><p id="ricevuto"></p>
    <script>window.addEventListener('load', () => setTimeout(() => { const t = document.getElementById('m');
      document.getElementById('ricevuto').textContent = t.value; t.addEventListener('input', () => { document.getElementById('ricevuto').textContent = t.value; }); }, 300));</script></body>`);
  await page.locator('#m').click();
  await page.keyboard.type('testo per il sito');
  await page.waitForTimeout(1500);
  await page.reload();
  await pronta(page);
  await expect.poll(() => page.locator('#m').inputValue(), { timeout: 8000 }).toBe('testo per il sito');
  await expect(page.locator('#ricevuto')).toHaveText('testo per il sito', { timeout: 3000 });
});

test('Filo che si chiude di colpo (processo ucciso): alla ripartenza il testo torna', async ({ testServer }) => {
  const url = testServer.html(`<!doctype html><body style="padding:24px"><textarea id="m" name="m" style="width:300px;height:60px"></textarea></body>`);
  const host = new URL(url).hostname;
  const userData = cartellaTemporanea('filo-testo-crash-');
  const lancia = () => electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  const sulPosto = (w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } };
  let app = null;
  try {
    app = await lancia();
    const shell = await primaFinestra(app);
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => Boolean(page = app.windows().find(sulPosto)), { timeout: 15000 }).toBe(true);
    await pronta(page);
    await page.locator('#m').click();
    await page.keyboard.type('prima del crollo');
    await page.waitForTimeout(3000);
    app.process().kill('SIGKILL');
    app = null;
    app = await lancia();
    let tornata = null;
    await expect.poll(() => Boolean(tornata = app.windows().find(sulPosto)), { timeout: 20000 }).toBe(true);
    await expect.poll(() => tornata.locator('#m').inputValue().catch(() => ''), { timeout: 15000 }).toBe('prima del crollo');
  } finally {
    if (app) await chiudiApp(app);
    togliCartella(userData);
  }
});

test('cinquantamila caratteri incollati tornano interi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:24px"><textarea name="m" style="width:300px;height:60px"></textarea></body>`);
  const lungo = 'parola lunga 😀 '.repeat(3200);
  await page.locator('textarea').click();
  await page.keyboard.insertText(lungo);
  await page.waitForTimeout(1500);
  await page.reload();
  await pronta(page);
  await expect.poll(() => page.locator('textarea').inputValue().then((v) => v.length), { timeout: 8000 }).toBe(lungo.length);
});
