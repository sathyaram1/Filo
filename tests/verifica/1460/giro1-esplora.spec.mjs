// Esplorazione della prima ora: uno scatto per passo (si cancella dopo la verifica).
import { test, expect } from '../../fixtures/electron.mjs';
import { captureComposite } from '../../agent/driver.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { barraPage, comandaBarra } from '../../helpers/barra.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SC = process.env.FILO_TEST_SCALE || '1';
const DIR = join(ROOT, 'tests', '.shots', `v1460-${SC}`);
mkdirSync(DIR, { recursive: true });
const shot = (app, n) => captureComposite(app, join(DIR, n + '.png')).catch((e) => console.log('shot', n, e.message));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test.use({ accoglienzaFatta: false, stratoDelMenu: true });

async function newtab(app) {
  for (let i = 0; i < 100; i++) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await pausa(100);
  }
  throw new Error('newtab');
}

async function stub(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash', [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__r = [];
    const reply = (m) => {
      const all = JSON.stringify(m || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna, le tue lezioni ti aspettano.', suggestions: [] });
      return globalThis.__r.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => { const t = reply(messages); try { onDelta && onDelta(t); } catch (_) {} return { text: t, model: attempts[0].model, provider: attempts[0].provider, usage: {} }; };
    P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
}
const coda = (app, ...r) => app.evaluate((_e, rs) => { globalThis.__r.push(...rs); }, r.map((x) => JSON.stringify(x)));

test('prima ora', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(400_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  let page = await newtab(app);
  await stub(app);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await pausa(1500);
  await shot(app, '01-benvenuto');

  await coda(app, { text: 'Piacere Anna. Ti scrivo breve. Vuoi il tema scuro o chiaro? Dimmi anche che lavoro fai, così preparo la home per te.', actions: [{ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Risposte brevi, dà del tu.' }, { type: 'ONBOARDING', spunta: ['profilo', 'stile'] }] });
  await page.locator('#input').fill('sono Anna, insegnante, scrivimi breve');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });
  await pausa(1200);
  await shot(app, '02-intervista-risposta');

  await coda(app, { text: 'Ci siamo capiti. Buon lavoro, Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'], fine: true }] });
  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();
  await pausa(6000);
  await shot(app, '03-dopo-intervista');

  page = await newtab(app);
  await coda(app, { text: 'Roma è la capitale d\'Italia, con circa 2,8 milioni di abitanti. Ti serve altro sulla città, come musei, trasporti o il meteo di oggi?', actions: [] });
  await page.locator('#input').fill('qual è la capitale d\'Italia?');
  await page.locator('#sendBtn').click();
  await pausa(4000);
  await shot(app, '04-chat-home');

  // schede
  const sito = testServer.html(`<!doctype html><html><head><title>Ricette di casa: la pasta al forno della nonna</title></head><body style="margin:0;padding:40px;font:16px sans-serif">
    <h1>Pasta al forno</h1><p id="p">Un testo da selezionare per il menu del tasto destro, abbastanza lungo da avere una frase intera.</p>
    <p><a id="link" href="https://example.com/ricetta">Vai alla ricetta</a></p>
    <img id="img" width="200" height="120" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='120'><rect width='200' height='120' fill='%23c85'/></svg>">
    <p><a id="dl" href="/dl/ricette.pdf">Scarica il pdf</a></p></body></html>`);
  const p1 = await openTab(sito);
  await p1.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 });
  await openTab(testServer.html('<!doctype html><title>Seconda</title><body>due</body>'));
  await openTab(testServer.html('<!doctype html><title>Terza scheda con un titolo molto lungo che non sta nella linguetta</title><body>tre</body>'));
  await pausa(1500);
  await shot(app, '05-schede');
  // chiudi l'ultima
  await shell.keyboard.press('Control+w').catch(() => {});
  await pausa(800);
  await shot(app, '06-scheda-chiusa');

  // torna alla prima scheda sito
  await shell.locator('.tab', { hasText: 'Ricette' }).click();
  await pausa(800);
  // barra laterale
  await barraPage(app);
  await comandaBarra(app, 'clic');
  await pausa(1500);
  await shot(app, '07-barra-laterale');
  await comandaBarra(app, 'chiudi');
  await pausa(800);

  // tasto destro
  const m = () => menuDi(p1);
  await p1.mouse.click(600, 500, { button: 'right' });
  await pausa(1200);
  await shot(app, '08-menu-pagina');
  await p1.keyboard.press('Escape'); await pausa(500);
  await p1.locator('#link').click({ button: 'right' });
  await pausa(1200);
  await shot(app, '09-menu-link');
  await p1.keyboard.press('Escape'); await pausa(500);
  await p1.locator('#img').click({ button: 'right' });
  await pausa(1200);
  await shot(app, '10-menu-immagine');
  await p1.keyboard.press('Escape'); await pausa(500);
  await p1.locator('#p').dblclick();
  await p1.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p1.locator('#p').click({ button: 'right', position: { x: 50, y: 8 } });
  await pausa(1500);
  await shot(app, '11-menu-testo');
  await p1.keyboard.press('Escape'); await pausa(500);
  void m;

  // preferenze
  const pref = await openTab('filo://options/options.html');
  await pausa(2000);
  await shot(app, '12-preferenze');
  const sezioni = await pref.locator('nav a, nav button, [data-section]').evaluateAll((els) => els.slice(0, 6).map((e, i) => i));
  const navs = pref.locator('nav a, nav button');
  const n = Math.min(await navs.count(), 5);
  for (let i = 1; i < n; i++) {
    await navs.nth(i).click().catch(() => {});
    await pausa(1200);
    await shot(app, `13-preferenze-${i}`);
  }
  void sezioni;

  // download
  const srv = createServer((req, res) => { const b = Buffer.from('%PDF-1.4\n' + 'x'.repeat(4096)); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': b.length, 'Content-Disposition': 'attachment; filename="ricette di casa.pdf"' }); res.end(b); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const pd = await openTab(testServer.html(`<!doctype html><title>Download</title><body style="padding:40px"><a id="d" href="http://127.0.0.1:${srv.address().port}/x.pdf">scarica</a></body>`));
  await pd.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10_000 }).catch(() => {});
  await pd.locator('#d').click();
  await pausa(2500);
  await shot(app, '14-download');
  srv.close();

  // notifica
  await shell.evaluate(() => window.filoNotify('Il download di «ricette di casa.pdf» è finito', { durationSec: 0 }));
  await pausa(1200);
  await shot(app, '15-notifica');
});
