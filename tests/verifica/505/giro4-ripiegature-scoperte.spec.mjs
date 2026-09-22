// #505 giro 4 — le ripiegature che l'elenco non conosce ancora, e il rovescio.
//
// Stessa domanda dei giri 1, 2 e 3: il sito sceglie COME ripiega una sezione, e
// da quella scelta non possono dipendere né cosa vede l'utente né quanto paga.
// Qui il pannello è spinto fuori dallo schermo restando nel flusso, oppure
// ritagliato via con una forma diversa dal rettangolo, oppure girato col retro
// verso l'utente: modi che lasciano lo schermo identico a quelli già coperti.

import { test, expect } from '../../fixtures/electron.mjs';

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

// Fuori dallo schermo restando nel flusso, e ritagliato via con una forma che
// non è un rettangolo: le due famiglie che un utente incontra sul serio.
const COMUNI = [
  ['A', 'pannello spinto fuori a sinistra con left negativo, restando nel flusso'],
  ['B', 'pannello spinto fuori a sinistra da un margine negativo'],
  ['C', 'pannello spinto fuori a sinistra da una traslazione, restando nel flusso'],
  ['D', 'pannello ritagliato via da una forma vuota'],
  ['E', 'pannello ritagliato via da un cerchio di raggio zero'],
  ['F', 'testo fatto sparire da un rientro di novemila pixel dentro un ritaglio'],
];
const STILI = {
  A: 'position:relative;left:-9999px',
  B: 'margin-left:-9999px',
  C: 'transform:translateX(-9999px)',
  D: 'clip-path:polygon(0 0,0 0,0 0)',
  E: 'clip-path:circle(0)',
  F: 'text-indent:-9999px;overflow:hidden;white-space:nowrap',
  G: 'transform:rotateY(180deg);backface-visibility:hidden',
  H: 'mask-image:linear-gradient(transparent,transparent)',
  I: 'contain:strict',
  J: 'font-size:0',
};
// Più rare: la scheda che si gira col retro verso l'utente, la maschera
// completamente trasparente, il contenimento stretto, il testo a misura zero.
const RARE = [
  ['G', 'retro di una scheda che si gira'],
  ['H', 'pannello coperto da una maschera tutta trasparente'],
  ['I', 'pannello chiuso col contenimento stretto'],
  ['J', 'testo portato a misura zero'],
];

const riga = ([k, d]) => `<div id="p${k}" style="${STILI[k]}">${frase(k, d)}</div>`;
const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  ${[...COMUNI, ...RARE].map(riga).join('\n  ')}
  <div id="pRifA" style="position:absolute;left:-9999px;width:300px">Reference panel pushed off screen the way Filo already knows.</div>
  <div id="pRifB" style="clip-path:inset(100%)">Reference panel clipped away the way Filo already knows.</div>
</body></html>`;

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      globalThis.__filoTranslatePrompts.push(chunk);
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);
const spedito = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

async function apriMenu(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

async function traduciTutto(page) {
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
}

// Nessuno di questi pannelli lascia un pixel leggibile sullo schermo: se uno si
// vedesse davvero, la prova direbbe altro. Si guarda dove finisce il TESTO (le
// misure del suo intervallo), non la scatola: un rientro di novemila pixel
// lascia la scatola dov'è e porta via solo le lettere.
async function nienteSulloSchermo(page, chiavi) {
  const visibili = await page.evaluate((ks) => ks.filter((k) => {
    const el = document.getElementById('p' + k);
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) return false;
    if (cs.clipPath !== 'none' || cs.maskImage !== 'none') return false;
    if (cs.backfaceVisibility !== 'visible' || parseFloat(cs.fontSize) === 0) return false;
    const scatola = el.getBoundingClientRect();
    if (scatola.width * scatola.height <= 0) return false;
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].some((t) => t.width > 0 && t.height > 0
      && t.right > 0 && t.bottom > 0 && t.left < innerWidth && t.top < innerHeight);
  }), chiavi);
  expect(visibili, `pannelli che si vedono davvero: ${visibili.join(', ')}`).toEqual([]);
}

async function pagate(app, forme) {
  const inviato = await spedito(app);
  return forme.filter(([k]) => inviato.includes(parola(k))).map(([k, d]) => `${k} (${d})`);
}

test('le ripiegature comuni che restano: nessuna si paga prima che l’utente apra', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);
  await page.screenshot({ path: 'tests/.shots/505-giro4-ripiegature.png' });

  // I due pannelli di paragone sono chiusi nello stesso modo, con la scrittura
  // che Filo già conosce: se partissero anche loro la prova direbbe altro.
  await expect(page.locator('#pRifA')).not.toHaveText(/^IT /);
  await expect(page.locator('#pRifB')).not.toHaveText(/^IT /);

  await nienteSulloSchermo(page, COMUNI.map(([k]) => k));
  const spese = await pagate(app, COMUNI);
  expect(spese, `sezioni chiuse spedite al modello e quindi pagate: ${spese.join(', ')}`).toEqual([]);
});

test('le ripiegature più rare che restano: nessuna si paga prima che l’utente apra', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  await nienteSulloSchermo(page, RARE.map(([k]) => k));
  const spese = await pagate(app, RARE);
  expect(spese, `sezioni chiuse spedite al modello e quindi pagate: ${spese.join(', ')}`).toEqual([]);
});

// La seconda metà della stessa regola: rimandare senza accorgersi
// dell'apertura lascerebbe l'inglese sullo schermo.
test('aperte, quelle sezioni fanno offrire la traduzione del testo nuovo', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduciTutto(page);

  await expect(await apriMenu(page, '#intro')).toHaveAttribute('aria-label', 'Mostra originale');
  await page.keyboard.press('Escape');

  const mancate = [];
  for (const [k, descr] of [...COMUNI, ...RARE]) {
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (el) el.setAttribute('style', '');
    }, k);
    await page.waitForTimeout(150);
    const btn = await apriMenu(page, '#intro');
    const label = await btn.getAttribute('aria-label');
    if (label !== 'Traduci il testo nuovo') mancate.push(`${k} (${descr}) → "${label}"`);
    await page.keyboard.press('Escape');
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (el) el.style.display = 'none';
    }, k);
    await page.waitForTimeout(150);
  }
  expect(mancate, `sezioni che, una volta aperte, non fanno offrire la traduzione: ${mancate.join(' | ')}`).toEqual([]);
});

// Il rovescio, perché una regola più larga non porti via del testo che si legge:
// la scritta girata di lato, il banner appoggiato in basso, la scheda ritagliata
// coi bordi tondi, la dissolvenza appena accennata, la maschera sfumata.
const VISIBILI = [
  ['VA', 'writing-mode:vertical-rl;height:200px'],
  ['VB', 'position:fixed;bottom:0;left:0;width:400px;background:#fff'],
  ['VC', 'clip-path:inset(0)'],
  ['VD', 'position:absolute;left:20px;top:400px;width:300px'],
  ['VE', 'filter:opacity(0.05)'],
  ['VF', 'position:fixed;right:0;top:0;width:200px;background:#fff'],
  ['VG', 'contain:paint'],
  ['VH', 'mask-image:linear-gradient(#000,transparent)'],
  ['VI', 'transform:rotateY(180deg)'],
];
const PAGINA_VISIBILE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  ${VISIBILI.map(([k, st]) => `<div id="p${k}" style="${st}">Visible ${parola(k)} text painted on the screen for everybody to read right now.</div>`).join('\n  ')}
</body></html>`;

test('quel che si vede resta tradotto, comunque il sito lo abbia disegnato', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA_VISIBILE);
  await watchToasts(page);
  await traduciTutto(page);
  await page.screenshot({ path: 'tests/.shots/505-giro4-visibili.png', fullPage: true });

  const lasciati = [];
  for (const [k, st] of VISIBILI) {
    const t = (await page.locator(`#p${k}`).innerText()).trim();
    if (!/^IT /.test(t)) lasciati.push(`${k} (${st})`);
  }
  expect(lasciati, `testo che si vede e resta in lingua originale: ${lasciati.join(', ')}`).toEqual([]);
});
