// Esplorazione col modello vero (chiave OpenRouter dell'ambiente): intervista rifatta e chat normale con la memoria piena.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

test.skip(!process.env.OPENROUTER_API_KEY, 'serve il modello vero');
const OUT = join(process.cwd(), 'tests', '.shots', '2536.1-g2');
const RIPETI = Number(process.env.RIPETI || 4);
const FRASE = 'ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria';

function newtabWindows(app) { return app.windows().filter((w) => w.url().startsWith('filo://newtab')); }
async function newtabPage(app, index = 0) {
  await expect.poll(() => newtabWindows(app).length, { timeout: 15_000 }).toBeGreaterThan(index);
  const win = newtabWindows(app)[index];
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function base(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
  await app.evaluate(async (_, key) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: key } });
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Fa il geometra in uno studio tecnico.\nHa un gatto, Pepe.', PREFERENZE: 'Preferisce risposte brevi.' });
    await globalThis.SN_FILO_MEMORY.appendLesson('Ha prenotato un volo per Lisbona.');
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chiamate = [];
    const orig = P.streamCompleteWithFallback;
    P.streamCompleteWithFallback = async (o) => {
      const r = await orig(o);
      if (JSON.stringify(o.messages?.[0] ?? '').includes('Sei Filo, l\'assistente dentro il browser Filo')) {
        globalThis.__chiamate.push({ model: r && r.model, toolCalls: r && r.toolCalls, text: r && String(r.text || '').slice(0, 300) });
      }
      return r;
    };
  }, process.env.OPENROUTER_API_KEY);
}

async function intervista(app, shell, openTab) {
  await base(app, shell);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  const p = await newtabPage(app, 1);
  await expect(p.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
  return p;
}

async function rispostaDopo(page, testo) {
  const prima = await page.locator('.dash-bubble-filo').count();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect.poll(() => page.locator('.dash-bubble-filo').count(), { timeout: 120_000 }).toBeGreaterThan(prima);
  let ultimo = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    const t = await page.locator('.dash-bubble-filo').last().innerText();
    if (t && t === ultimo) break;
    ultimo = t;
  }
  await page.waitForTimeout(6000);
  return ultimo;
}

async function registra(app, page, nome, risposta) {
  const memoria = JSON.stringify(await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory()));
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const attivita = await page.locator('.dash-activity').allInnerTexts().catch(() => []);
  const tag = `${nome}-${test.info().retry}`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ risposta, memoria, attivita, chiamate }, null, 2));
  await page.screenshot({ path: join(OUT, `${tag}.png`) });
  return memoria;
}

for (let i = 1; i <= RIPETI; i++) {
  test(`intervista togli ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    const p = await intervista(app, shell, openTab);
    const r = await rispostaDopo(p, `sono luca. ${FRASE}`);
    const m = await registra(app, p, `int-togli-${i}`, r);
    expect(m).not.toContain('Pepe');
  });
  test(`chat togli ${i}`, async ({ app, shell }) => {
    test.setTimeout(300_000);
    await base(app, shell);
    const home = await newtabPage(app, 0);
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    const r = await rispostaDopo(home, FRASE);
    const m = await registra(app, home, `chat-togli-${i}`, r);
    expect(m).not.toContain('Pepe');
  });
  test(`intervista ricordi ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    const p = await intervista(app, shell, openTab);
    const r = await rispostaDopo(p, 'sono luca. prima di andare avanti: cosa ti ricordi già di me?');
    await registra(app, p, `int-ricordi-${i}`, r);
    expect(r).toMatch(/geometra|Pepe|Lisbona/i);
  });
}
