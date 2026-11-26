// Verifica #810.24 giro 1: la bozza rimessa dal sito dopo un riavvio vero, e la proposta dell'assistente per un campo.
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODICE = '482913';
const CARTA = '4111 1111 1111 1111';
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// L'assistente risponde con la prima coppia la cui parola sta nell'ultimo messaggio dell'utente.
async function modelloFinto(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts, messages) => {
      const testo = JSON.stringify(messages);
      if (testo.includes('preparare la dashboard')) return { text: '{"message":"Ciao.","suggestions":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (testo.includes('scritto in un campo editabile')) return { text: '{"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([p]) => ultimo.includes(p)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
    P.streamCompleteWithFallback = async ({ attempts, messages }) => risposta(attempts, messages);
  }, risposte);
}

async function apriAiuto(app, shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await expect(aiuto.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return aiuto;
}
async function scriviAllAiuto(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}
const letti = (app) => app.evaluate(() => globalThis.SN_SEGRETI_LETTI.tutti().map((x) => x.valore.replace(/[\s-]/g, '').toLowerCase()));

async function apriScheda(app, shell, url) {
  const host = new URL(url).host;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return new URL(w.url()).host === host; } catch (_) { return false; } }) || null;
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  return page;
}

// La posta salva da sé la bozza nel browser e la rimette alla riapertura.
const POSTA = `<!doctype html><html><head><title>Posta</title></head><body style="padding:40px;font:16px sans-serif">
<h1>Nuovo messaggio</h1><p>Avviso del gestore: il tuo codice monouso è 731954.</p>
<div id="ed" contenteditable="true" style="min-height:80px;border:1px solid"></div>
<script>var ed=document.getElementById('ed');ed.textContent=localStorage.getItem('bozza')||'';
ed.addEventListener('input',function(){localStorage.setItem('bozza',ed.textContent);});</script></body></html>`;

test('la bozza che il sito rimette dopo un riavvio vero non porta la carta dell’utente fra i segreti letti', async ({ testServer }) => {
  test.setTimeout(180_000);
  const userData = cartellaTemporanea('filo-verifica-810-24-');
  const url = testServer.html(POSTA);
  const launch = () => electron.launch({ args: [...argomentiScala, '.'], cwd: RADICE, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  let app = await launch();
  try {
    const shell = await primaFinestra(app);
    const page = await apriScheda(app, shell, url);
    await page.locator('#ed').click();
    await page.keyboard.type(`Ciao Marco, la carta è ${CARTA}.`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('bozza'))).toContain(CARTA);
    await page.waitForTimeout(3000);
  } finally {
    await chiudiApp(app);
  }
  app = await launch();
  try {
    const shell = await primaFinestra(app);
    await preparaModelli(app);
    await modelloFinto(app, [['', '{"text":"Ecco.","status":"done"}']]);
    const page = await apriScheda(app, shell, url);
    await expect(page.locator('#ed')).toContainText(CARTA);
    const aiuto = await apriAiuto(app, shell, page);
    await scriviAllAiuto(aiuto, 'correggi il messaggio');
    await expect(aiuto.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('731954');
    expect(await letti(app), 'la carta della bozza è finita fra i segreti letti').not.toContain(CARTA.replace(/ /g, ''));
  } finally {
    await chiudiApp(app);
  }
});

const BANCA = `<!doctype html><html><head><title>Banca Esempio</title></head><body style="padding:40px;font:16px sans-serif">
<h1>Accesso</h1><p>Il tuo codice monouso è ${CODICE}. Non darlo a nessuno.</p>
<label for="otp">Codice</label> <input id="otp"><button>Continua</button></body></html>`;
const PROPOSTA = JSON.stringify({ text: 'Mettilo qui.', status: 'done', highlight: { selector: '#otp', action: 'fill', value: CODICE, note: 'Il codice' } });

for (const accetta of [false, true]) {
  test(`il codice letto e riscritto all’assistente resta letto quando lui lo propone per il campo${accetta ? ' e l’utente accetta' : ''}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(90_000);
    const page = await testServer.openReady(openTab, BANCA);
    await preparaModelli(app);
    await modelloFinto(app, [['dove lo metto', PROPOSTA], ['', '{"text":"Ecco.","status":"done"}']]);
    const aiuto = await apriAiuto(app, shell, page);
    await scriviAllAiuto(aiuto, 'cosa devo fare?');
    await expect(aiuto.locator('.sn-sidebar').getByText('Ecco.')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => letti(app), { timeout: 10_000 }).toContain(CODICE);
    await aiuto.locator('.sn-sidebar-input textarea').click();
    await aiuto.keyboard.type(`il codice ${CODICE} dove lo metto?`);
    await aiuto.keyboard.press('Enter');
    await expect(aiuto.locator('.sn-highlight-accept')).toBeVisible({ timeout: 20_000 });
    if (accetta) {
      await aiuto.locator('.sn-highlight-accept').click();
      await expect(page.locator('#otp')).toHaveValue(CODICE);
    }
    await page.waitForTimeout(3000);
    expect(await letti(app), 'il codice letto è sparito dal registro').toContain(CODICE);
    await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
    expect(await letti(app), 'il codice letto non è più nel file').toContain(CODICE);
  });
}
