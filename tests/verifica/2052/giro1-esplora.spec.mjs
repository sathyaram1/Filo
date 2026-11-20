// #2052 giro 1 — il testo che Filo mette nella casella di un commento (dentro un'ombra, come quella di Reddit) il sito
// lo deve ricevere: Incolla dal menu, correzione automatica, ritorno del testo alla ricarica, un incolla lunghissimo.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { batti } from '../../helpers/tastiera.mjs';

// Il componente tiene il testo dai soli eventi che arrivano a lui, fuori dall'ombra: come un commento di Reddit.
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Commento</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <mock-composer id="c"></mock-composer>
  <button id="invia">Comment</button>
  <p id="esito"></p>
  <script>
    class MockComposer extends HTMLElement {
      constructor() {
        super();
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<textarea id="t" lang="it" style="display:block;width:760px;height:200px;font:18px monospace"></textarea>';
        this.modello = '';
        this.addEventListener('input', () => { this.modello = r.getElementById('t').value; });
      }
    }
    customElements.define('mock-composer', MockComposer);
    document.getElementById('invia').onclick = () => {
      const c = document.getElementById('c');
      document.getElementById('esito').textContent = c.modello.trim() ? 'inviato: ' + c.modello : 'Comment cannot be empty';
    };
  </script>
</body>`;

const casella = (page) => page.locator('#c').locator('textarea');
const valore = (page) => casella(page).inputValue();
const modello = (page) => page.evaluate(() => document.getElementById('c').modello);

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, ripetizioni: true, automatica: true },
    });
    const finto = async () => ({ text: 'NIENTE', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

async function apri(app, openTab, testServer) {
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const appunti = (app, testo) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);

async function incollaDaFilo(page) {
  await casella(page).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-paste-main')).toBeVisible({ timeout: 5000 });
  await menu.locator('.sn-menu-paste-main').click();
}

async function inviaECommento(page) {
  await page.locator('#invia').click();
  return page.locator('#esito').textContent();
}

test('Incolla dal menu di Filo in un commento: il sito riceve il testo esatto, a capo e simboli compresi', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const testo = 'Ok, ora è più chiaro.\n\nSul motore:   regole <b>diverse</b> & niente "euristiche".\n\tripeto non era scacchi\nfine  ';
  await appunti(app, testo);
  await incollaDaFilo(page);
  await expect.poll(() => valore(page)).toBe(testo);
  expect(await modello(page)).toBe(testo);
  expect(await inviaECommento(page)).toBe('inviato: ' + testo);
});

test('Incolla in un commento che ha già del testo battuto: il sito riceve tutto', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await casella(page).click();
  await page.keyboard.type('Inizio ');
  await appunti(app, 'incollato\nseconda riga');
  await incollaDaFilo(page);
  await expect.poll(() => valore(page)).toBe('Inizio incollato\nseconda riga');
  expect(await modello(page)).toBe('Inizio incollato\nseconda riga');
});

test('la correzione automatica in un commento: il sito riceve la parola corretta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await casella(page).click();
  await batti(page, 'ok perchè ');
  await expect.poll(() => valore(page)).toBe('ok perché ');
  expect(await modello(page)).toBe('ok perché ');
});

test('un incolla di mille righe da Filo arriva intero e in fretta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const testo = Array.from({ length: 1000 }, (_, i) => `riga ${i}  con   spazi`).join('\n');
  await appunti(app, testo);
  const t0 = Date.now();
  await incollaDaFilo(page);
  await expect.poll(() => valore(page), { timeout: 20_000 }).toBe(testo);
  const ms = Date.now() - t0;
  expect(await modello(page)).toBe(testo);
  expect(ms, `ci ha messo ${ms} ms`).toBeLessThan(5000);
});

test('alla ricarica il testo del commento torna e il sito lo riceve', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await casella(page).click();
  await page.keyboard.type('Un commento lungo\nsu due righe');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => valore(page), { timeout: 10_000 }).toBe('Un commento lungo\nsu due righe');
  expect(await modello(page)).toBe('Un commento lungo\nsu due righe');
  expect(await inviaECommento(page)).toBe('inviato: Un commento lungo\nsu due righe');
});
