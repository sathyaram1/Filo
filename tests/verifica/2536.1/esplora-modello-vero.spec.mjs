// Esplorazione col modello vero (chiave OpenRouter dell'ambiente): intervista rifatta con la memoria piena.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

const OUT = join(process.cwd(), 'tests', '.shots', '2536.1');
const RIPETI = Number(process.env.RIPETI || 5);

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
        globalThis.__chiamate.push({ model: r && r.model, toolCalls: r && r.toolCalls, text: r && String(r.text || '').slice(0, 200) });
      }
      return r;
    };
  }, process.env.OPENROUTER_API_KEY);
}

async function prepara(app, shell, openTab) {
  await base(app, shell);
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  const intervista = await newtabPage(app, 1);
  await expect(intervista.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(intervista.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 90_000 });
  return intervista;
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
  return ultimo;
}

const memoria = (app) => app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()));
const attivita = (page) => page.locator('.dash-activity').allInnerTexts().catch(() => []);

for (let i = 1; i <= RIPETI; i++) {
  test(`togli pepe ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    const intervista = await prepara(app, shell, openTab);
    const benvenuto = await intervista.locator('.dash-bubble-filo').first().innerText();
    const r = await rispostaDopo(intervista, 'sono luca. ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    await intervista.waitForTimeout(8000);
    const m = await memoria(app);
    const tag = `${i}-${test.info().retry}`;
    const tutte = await intervista.locator('.dash-bubble').allInnerTexts();
    mkdirSync(OUT, { recursive: true });
    const chiamate = await app.evaluate(() => globalThis.__chiamate);
    writeFileSync(join(OUT, `togli-${tag}.json`), JSON.stringify({ benvenuto, risposta: r, tutte, memoria: m, attivita: await attivita(intervista), chiamate }, null, 2));
    await intervista.screenshot({ path: join(OUT, `togli-${tag}.png`) });
    expect(m).not.toContain('Pepe');
  });
  test(`controllo chat normale ${i}`, async ({ app, shell }) => {
    test.setTimeout(300_000);
    await base(app, shell);
    const home = await newtabPage(app, 0);
    await home.reload();
    await home.waitForLoadState('domcontentloaded');
    const r = await rispostaDopo(home, 'ah il mio gatto pepe purtroppo non c\'è più, toglilo dalla memoria');
    await home.waitForTimeout(8000);
    const m = await memoria(app);
    const tag = `${i}-${test.info().retry}`;
    const chiamate = await app.evaluate(() => globalThis.__chiamate);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `controllo-${tag}.json`), JSON.stringify({ risposta: r, memoria: m, attivita: await attivita(home), chiamate }, null, 2));
    await home.screenshot({ path: join(OUT, `controllo-${tag}.png`) });
    expect(m).not.toContain('Pepe');
  });
  if (process.env.SOLO_TOGLI) continue;
  test(`cosa ricordi ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    const intervista = await prepara(app, shell, openTab);
    const r = await rispostaDopo(intervista, 'sono luca. prima di andare avanti: cosa ti ricordi già di me?');
    const tag = `${i}-${test.info().retry}`;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `ricordi-${tag}.json`), JSON.stringify({ risposta: r, attivita: await attivita(intervista) }, null, 2));
    expect(r).toMatch(/geometra|Pepe|Lisbona/i);
  });
}

for (let i = 1; i <= RIPETI; i++) {
  test(`correggi ${i}`, async ({ app, shell, openTab }) => {
    test.setTimeout(300_000);
    const intervista = await prepara(app, shell, openTab);
    const r = await rispostaDopo(intervista, 'sono luca. ah non faccio più il geometra, adesso faccio l\'architetto: correggilo in memoria');
    await intervista.waitForTimeout(8000);
    const m = await memoria(app);
    const tag = `${i}-${test.info().retry}`;
    const chiamate = await app.evaluate(() => globalThis.__chiamate);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `correggi-${tag}.json`), JSON.stringify({ risposta: r, memoria: m, attivita: await attivita(intervista), chiamate }, null, 2));
    await intervista.screenshot({ path: join(OUT, `correggi-${tag}.png`) });
    expect(m).toContain('architetto');
  });
}
