// #1115, #1446 — i suggerimenti del correttore: i puntini ocra sotto ciò che non torna con la pagina. Una conversazione
// che parla di martedì e «sì ci vediamo mercoledì» nella casella: i puntini stanno su «mercoledì» e il tasto destro
// mostra la citazione; una citazione che nella pagina non c'è non lascia niente; le date le trova il codice; errori e
// suggerimenti si spengono ognuno da sé, dalla pagina Altro. Il modello è finto: nessuna chiamata esce dalla macchina.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno, stileDelSegno } from './helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<main>
  <div class="chat">
    <p>Anna: ciao! ci vediamo martedì?</p>
    <p>Tu: sì, alle 18 davanti al cinema</p>
    <p>Anna: perfetto, porto io i biglietti</p>
  </div>
  <textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>
</main>
</body>`;

// `__ocraRisposta` è quello che il modello finto risponde al controllo ragionato, scritto come gli `issues` di una volta
// e tradotto qui nelle righe [pezzo][correzione][motivo][tipo]; il controllo rapido non trova mai niente.
async function apri(app, openTab, testServer, risposta, html = PAGINA) {
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    globalThis.__ocraRisposta = risposta;
    const righe = (json) => {
      let issues = [];
      try { issues = JSON.parse(json).issues || []; } catch (_) {}
      return issues.map((i) => (i.tipo === 'contraddizione'
        ? `[${i.testo}][${i.correzione || ''}][${i.spiegazione || ''}][contraddizione][${i.citazione || ''}]`
        : `[${i.testo}][${i.correzione || ''}][${i.spiegazione || ''}][suggerimento]`)).join('\n') || '[][][][nessuno]';
    };
    globalThis.__righeOcra = righe;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('proponi SUGGERIMENTI')) {
        globalThis.__ocra.push(messages[messages.length - 1].content);
        return fine(righe(globalThis.__ocraRisposta));
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposta);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const chiamate = (app) => app.evaluate(() => globalThis.__ocra.length);
const contraddizione = (citazione) => JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione, spiegazione: 'Prima si era detto martedì.', correzione: 'martedì',
}] });

async function tastoDestroSu(page, segno) {
  const b = await riquadroDelSegno(segno);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page).pannelli;
  await expect(menu).toBeVisible({ timeout: 5000 });
  return menu;
}

test('la contraddizione con la conversazione: ocra su «mercoledì», il tasto destro mostra la citazione e corregge', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });

  // Il modello ha visto la conversazione, prima del testo, e la data di oggi.
  const prompt = await app.evaluate(() => globalThis.__ocra.at(-1));
  expect(prompt).toContain('Anna: ciao! ci vediamo martedì?');
  expect(prompt).toContain('porto io i biglietti');
  expect(prompt.indexOf('porto io i biglietti')).toBeLessThan(prompt.indexOf('sì ci vediamo mercoledì'));
  expect(prompt).toMatch(/Oggi è \S+ \d{1,2} \S+ \d{4}/);

  // Il segno nuovo entra con un passaggio breve: il colore pieno si legge a passaggio finito.
  await expect.poll(() => ocra(page).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { linea: cs.textDecorationLine, stile: cs.textDecorationStyle, colore: cs.textDecorationColor };
  }), { timeout: 3000 }).toEqual({ linea: 'underline', stile: 'dotted', colore: 'rgb(176, 122, 20)' });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-contraddizione.png' }).catch(() => {});

  const menu = await tastoDestroSu(page, ocra(page).first());
  const riquadro = menu.locator('.sn-menu-segno');
  await expect(riquadro).toContainText('Prima si era detto martedì.');
  await expect(riquadro.locator('.sn-menu-segno-citazione')).toHaveText('prima: «ci vediamo martedì?»');
  await expect(menu.locator('.sn-menu-item', { hasText: 'Ignora' })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/1115-ocra-menu.png' }).catch(() => {});
  const correzione = menu.locator('.sn-menu-correction', { hasText: 'martedì' });
  await expect(correzione.locator('.sn-menu-correction-arrow')).toHaveCount(0);
  await correzione.locator('.sn-menu-correction-main').click();
  await expect(page.locator('#ta')).toHaveValue('sì ci vediamo martedì');
  await expect(ocra(page)).toHaveCount(0);
});

test('una citazione che nella pagina non c\'è: il modello la inventa e non compare niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo giovedì?'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect.poll(() => chiamate(app), { timeout: 12_000 }).toBe(1);
  await page.waitForTimeout(800);
  await expect(ocra(page)).toHaveCount(0);
});

test('data e giorno che non tornano si segnano senza modello; «Ignora» li toglie e per quel testo non tornano', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, '{"issues":[]}');
  await page.locator('#ta').click();
  await page.keyboard.type('allora mercoledì 9 ottobre 2026 alle 18');
  await expect(ocra(page)).toHaveText(['mercoledì 9 ottobre 2026'], { timeout: 5000 });

  let menu = await tastoDestroSu(page, ocra(page).first());
  await expect(menu.locator('.sn-menu-segno')).toHaveText('Il 9 ottobre 2026 è venerdì.');
  await expect(menu.locator('.sn-menu-correction')).toHaveText(['venerdì 9 ottobre 2026', 'mercoledì 7 ottobre 2026']);
  await menu.locator('.sn-menu-item', { hasText: 'Ignora' }).click();
  await expect(ocra(page)).toHaveCount(0);

  // Il fuoco esce e rientra: per quel testo il segno ignorato resta via.
  await page.mouse.click(700, 500);
  await page.waitForTimeout(400);
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(', va bene?');
  await expect.poll(() => chiamate(app), { timeout: 12_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await expect(ocra(page)).toHaveCount(0);

  // Un altro sbaglio nello stesso testo si segna, e la correzione si applica.
  await page.keyboard.type(' o giovedì 9 ottobre 2026');
  await expect(ocra(page)).toHaveText(['giovedì 9 ottobre 2026'], { timeout: 5000 });
  menu = await tastoDestroSu(page, ocra(page).first());
  await menu.locator('.sn-menu-correction-main', { hasText: 'venerdì 9 ottobre 2026' }).click();
  await expect(page.locator('#ta')).toHaveValue('allora mercoledì 9 ottobre 2026 alle 18, va bene? o venerdì 9 ottobre 2026');
});

test('i due interruttori stanno in Opzioni → Altro e ognuno spegne il suo segno', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, '{"issues":[]}');
  const altro = await openTab('filo://options/altro.html');
  const blu = altro.locator('#spellcheckErrori');
  const giallo = altro.locator('#spellcheckSuggerimenti');
  await expect(altro.locator('#spellcheckErrori-label')).toHaveText('Errori');
  await expect(altro.locator('#spellcheckSuggerimenti-label')).toHaveText('Suggerimenti');
  await expect(blu).toBeChecked({ timeout: 8000 });
  await expect(giallo).toBeChecked();
  await giallo.click();
  const flags = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).featureFlags);
  await expect.poll(flags, { timeout: 4000 }).toMatchObject({ spellcheck: true, spellcheckContext: false });
  await altro.screenshot({ path: 'tests/.shots/1115-altro-interruttori.png' }).catch(() => {});

  await page.bringToFront();
  await page.locator('#ta').click();
  await page.keyboard.type('mercoledì 9 ottobre 2026 ci vediamo');
  await page.waitForTimeout(5000);
  await expect(ocra(page)).toHaveCount(0);
  expect(await chiamate(app)).toBe(0);

  // Riacceso chiedendolo a Filo, la pagina Altro lo rimostra acceso senza ricaricarla, e il segno torna.
  const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_PREFERENZA', chiave: 'coerenza', valore: 'on' });
  expect(r.executed).toBe(true);
  await expect(giallo).toBeChecked({ timeout: 4000 });
  await page.bringToFront();
  await page.locator('#ta').click();
  await page.keyboard.type('!');
  await expect(ocra(page)).toHaveText(['mercoledì 9 ottobre 2026'], { timeout: 5000 });
});

test('aspetto: i puntini accanto all\'onda degli errori, anche sulla stessa parola, in tema chiaro e scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, JSON.stringify({ issues: [
    { tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì' },
    { tipo: 'poco_chiara', testo: 'lui gli', citazione: '', spiegazione: 'Non si capisce chi porta cosa.', correzione: '' },
  ] }));
  // Il controllo rapido, finto anche lui: «sonno» al posto di «sono», e «mercoledì» per i due segni sulla stessa parola.
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    const finto = async (req) => {
      if (JSON.stringify(req.messages).includes('Sei il controllo rapido')) {
        return { text: '[ieri sonno stato][ieri sono stato][verbo essere][errore]\n[mercoledì][martedì][x][errore]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      }
      return prima(req);
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  await page.locator('#ta').click();
  await page.keyboard.type('ieri sonno stato da Marco, ciaoo, ci vediamo mercoledì e lui gli porta');
  await expect(ocra(page)).toHaveText(['mercoledì', 'lui gli'], { timeout: 12_000 });
  await expect(page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)')).toHaveText(['sonno', 'mercoledì'], { timeout: 6000 });
  const insieme = page.locator('.sn-spell-overlay .sn-suggerimento > .sn-errore');
  await expect(insieme).toHaveText('mercoledì');
  const segni = () => insieme.evaluate((el) => {
    const e = getComputedStyle(el);
    const s = getComputedStyle(el.parentElement);
    return { onda: e.textDecorationStyle, coloreOnda: e.textDecorationColor, puntini: s.textDecorationStyle, colore: s.textDecorationColor };
  });
  await expect.poll(segni).toEqual({ onda: 'wavy', coloreOnda: 'rgb(180, 71, 44)', puntini: 'dotted', colore: 'rgb(176, 122, 20)' });
  await page.locator('#ta').evaluate((el) => el.blur());
  await page.locator('#ta').focus();
  await page.screenshot({ path: 'tests/.shots/1115-ocra-chiaro.png', clip: { x: 0, y: 0, width: 820, height: 320 } }).catch(() => {});

  // Il tema cambiato a overlay aperto arriva ai segni senza dover battere un tasto.
  await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' });
  await page.evaluate(() => { document.body.style.background = '#1e1d1b'; document.body.style.color = '#e5e3dc'; });
  await expect.poll(segni, { timeout: 5000 }).toEqual({ onda: 'wavy', coloreOnda: 'rgb(234, 138, 107)', puntini: 'dotted', colore: 'rgb(226, 173, 77)' });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-scuro.png', clip: { x: 0, y: 0, width: 820, height: 320 } }).catch(() => {});
});

test('su una pagina delicata il testo della pagina non parte: niente contraddizioni, le date restano', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ security: { pagineDelicate: { enabled: true, siti: ['sito-pubblico.test'] } } }));
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì e poi giovedì 9 ottobre 2026');
  await expect.poll(() => chiamate(app), { timeout: 12_000 }).toBe(1);
  const [prompt] = await app.evaluate(() => globalThis.__ocra);
  expect(prompt).not.toContain('porto io i biglietti');
  expect(prompt).not.toContain('Anna: ciao!');
  expect(prompt).toContain('sì ci vediamo mercoledì e poi giovedì 9 ottobre 2026');
  await page.waitForTimeout(800);
  // La citazione sarebbe nella pagina, ma il modello la pagina non l'ha vista: la contraddizione non vale.
  await expect(ocra(page)).toHaveText(['giovedì 9 ottobre 2026']);
});

// Invio in un campo modificabile apre un <div>, Maiusc+Invio mette un <br>: i segni devono stare sulla riga della parola,
// e le regole della pagina sui suoi tag (colore, bordi) non devono rendere visibile la copia trasparente del testo.
test('campo modificabile su più righe: i puntini stanno sotto la parola, sulla sua riga', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = PAGINA
    .replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>',
      '<div id="ce" contenteditable="true" style="width:760px;min-height:140px;border:1px solid #999;font:22px sans-serif"></div>')
    .replace('<main>', '<style>div div { color: #c00; border: 1px solid #c00; }</style><main>');
  const page = await apri(app, openTab, testServer, JSON.stringify({ issues: [
    { tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì' },
    { tipo: 'poco_chiara', testo: 'lui gli', citazione: '', spiegazione: 'Non si capisce chi porta cosa.', correzione: '' },
  ] }), html);
  await page.locator('#ce').click();
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('e lui gli porta');
  await expect(ocra(page)).toHaveText(['mercoledì', 'lui gli'], { timeout: 12_000 });
  const dove = (parola) => page.evaluate((parola) => {
    const w = document.createTreeWalker(document.getElementById('ce'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.nodeValue.indexOf(parola);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + parola.length);
      const q = r.getBoundingClientRect();
      return { x: Math.round(q.x), y: Math.round(q.y) };
    }
    return null;
  }, parola);
  for (const [k, parola] of [[0, 'mercoledì'], [1, 'lui gli']]) {
    const b = await riquadroDelSegno(ocra(page).nth(k));
    const v = await dove(parola);
    expect({ parola, dx: Math.abs(b.x - v.x) < 3, dy: Math.abs(b.y - v.y) < 3 }).toEqual({ parola, dx: true, dy: true });
  }
  const copia = await stileDelSegno(page.locator('.sn-spell-overlay div').first(), ['color', 'border-top-color']);
  expect(copia).toEqual({ color: 'rgba(0, 0, 0, 0)', 'border-top-color': 'rgba(0, 0, 0, 0)' });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-righe.png', clip: { x: 0, y: 0, width: 820, height: 340 } }).catch(() => {});
});

// Gli editor fatti di paragrafi (WhatsApp Web, ChatGPT, Slack): margini e interlinea dei <p> li decide il foglio di
// stile della pagina, e i segni devono stare sulla parola lo stesso, su una riga sola e sulle righe dopo.
const paragrafi = (stile, dentro) => PAGINA
  .replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>',
    `<div id="ce" class="ed" contenteditable="true" style="width:420px;min-height:44px;border:1px solid #999;font:20px sans-serif">${dentro}</div>`)
  .replace('<main>', `<style>${stile}</style><main>`);

const sullaParola = (page, parola) => page.evaluate((parola) => {
  const s = document.querySelector('.sn-spell-overlay .sn-suggerimento').getBoundingClientRect();
  const w = document.createTreeWalker(document.getElementById('ce'), NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const i = n.nodeValue.indexOf(parola);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + parola.length);
    const q = r.getBoundingClientRect();
    return { dx: Math.round(s.x - q.x), dy: Math.round(s.y - q.y), largo: Math.abs(s.width - q.width) < 3 };
  }
  return null;
}, parola);

for (const [nome, stile, dentro, riga] of [
  ['una riga sola, paragrafo senza margini', '.ed p{margin:0}', '<p><br></p>', 0],
  ['seconda riga, paragrafi senza margini', '.ed p{margin:0}', '<p>ok!</p><p><br></p>', 1],
  ['terza riga, interlinea dei paragrafi data dalla pagina', '.ed p{margin:0;line-height:1.8}', '<p>ok!</p><p>allora</p><p><br></p>', 2],
  ['seconda riga, margini dei paragrafi dati dalla pagina', '.ed p{margin:6px 0 10px}', '<p>ok!</p><p><br></p>', 1],
]) {
  test(`editor a paragrafi, ${nome}: i puntini stanno sotto la parola`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'), paragrafi(stile, dentro));
    await page.locator('#ce p').nth(riga).click();
    await page.keyboard.type('sì ci vediamo mercoledì');
    await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
    expect(await sullaParola(page, 'mercoledì')).toEqual({ dx: 0, dy: 0, largo: true });
  });
}

test('editor a paragrafi: una frase segnata che va a capo ha i puntini su tutte e due le righe', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, JSON.stringify({ issues: [{
    tipo: 'poco_chiara', testo: 'lui gli porta quello che gli aveva detto lui', citazione: '', spiegazione: 'Non si capisce chi.', correzione: '',
  }] }), paragrafi('.ed p{margin:0}', '<p><br></p>').replace('width:420px', 'width:300px'));
  await page.locator('#ce p').click();
  await page.keyboard.type('va bene, lui gli porta quello che gli aveva detto lui');
  await expect.poll(() => ocra(page).count(), { timeout: 12_000 }).toBeGreaterThan(1);
  const testi = await ocra(page).allTextContents();
  expect(testi.join(' ').replace(/\s+/g, ' ')).toBe('lui gli porta quello che gli aveva detto lui');
  const dove = await ocra(page).evaluateAll((s) => s.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(dove).size).toBe(dove.length);
  await page.screenshot({ path: 'tests/.shots/1115-ocra-paragrafi.png', clip: { x: 0, y: 0, width: 820, height: 260 } }).catch(() => {});
});

// Testo più alto della casella: lo specchio dei segni scorre con lei, va a capo come lei (margine interno e barra di
// scorrimento compresi) e non taglia i segni dell'ultima riga, che stanno qualche pixel sotto il testo.
const scorre = {
  righe: async (page, sel) => {
    await page.locator(sel).click();
    for (const r of ['uno', 'due', 'tre', 'quattro', 'cinque']) {
      await page.keyboard.type(r);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('allora va bene, ho sentito anche gli altri e sì ci vediamo mercoledì');
    await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
    await page.waitForTimeout(300);
  },
  misure: (page, sel) => page.evaluate((sel) => {
    const f = document.querySelector(sel);
    const o = document.querySelector('.sn-spell-overlay');
    const s = document.querySelector('.sn-spell-overlay .sn-suggerimento').getBoundingClientRect();
    const fr = f.getBoundingClientRect();
    const or = o.getBoundingClientRect();
    let parola = null;
    if (f.isContentEditable) {
      const w = document.createTreeWalker(f, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = n.nodeValue.indexOf('mercoledì');
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 9);
        const q = r.getBoundingClientRect();
        parola = { dx: Math.abs(q.x - s.x) < 3, dy: Math.abs(q.y - s.y) < 3 };
      }
    }
    return {
      // Lo specchio della casella di testo scorre con lei; sul campo modificabile i segni si misurano già scorsi.
      scorre: f.scrollTop > 0 && o.scrollTop === (f.isContentEditable ? 0 : f.scrollTop),
      // l'ultima riga è visibile nella casella e il suo segno non è tagliato dallo specchio
      visibile: s.top >= fr.top && s.top < fr.bottom && s.bottom + 4 <= or.bottom,
      parola,
    };
  }, sel),
};

test('campo modificabile che scorre, con margine interno: i puntini seguono lo scorrimento, sotto la parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const ce = PAGINA.replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>',
    '<div id="ce" contenteditable="true" style="width:400px;max-height:110px;overflow:auto;padding:14px;border:1px solid #999;font:22px sans-serif"></div>');
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'), ce);
  await scorre.righe(page, '#ce');
  expect(await scorre.misure(page, '#ce')).toEqual({ scorre: true, visibile: true, parola: { dx: true, dy: true } });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-scorre-ce.png', clip: { x: 0, y: 0, width: 820, height: 340 } }).catch(() => {});
});

test('casella di testo che scorre: i puntini seguono lo scorrimento e non sono tagliati sotto l\'ultima riga', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const ta = PAGINA.replace('height:140px', 'height:90px').replace('width:760px', 'width:400px');
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'), ta);
  await scorre.righe(page, '#ta');
  expect(await scorre.misure(page, '#ta')).toEqual({ scorre: true, visibile: true, parola: null });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-scorre-ta.png', clip: { x: 0, y: 0, width: 820, height: 340 } }).catch(() => {});
});

// Il modello al controllo dopo può segnare qualche parola in più o in meno della stessa frase: l'«Ignora» tiene.
test('«Ignora» tiene anche se il modello al giro dopo segna un pezzo un po\' diverso della stessa frase', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const menu = await tastoDestroSu(page, ocra(page).first());
  await menu.locator('.sn-menu-item', { hasText: 'Ignora' }).click();
  await expect(ocra(page)).toHaveCount(0);
  await app.evaluate(() => {
    globalThis.__ocraRisposta = JSON.stringify({ issues: [{
      tipo: 'contraddizione', testo: 'vediamo mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: '',
    }] });
  });
  await page.locator('#ta').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' alle 18');
  await expect.poll(() => chiamate(app), { timeout: 12_000 }).toBe(2);
  await page.waitForTimeout(800);
  await expect(ocra(page)).toHaveCount(0);
  // Un'altra contraddizione, su un altro pezzo, si segna.
  await app.evaluate(() => {
    globalThis.__ocraRisposta = JSON.stringify({ issues: [{
      tipo: 'contraddizione', testo: 'alle 19', citazione: 'sì, alle 18 davanti al cinema', spiegazione: 'Prima si era detto alle 18.', correzione: 'alle 18',
    }] });
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type('9');
  // Il segno sta su quello che la correzione cambia: «19» → «18».
  await expect(ocra(page)).toHaveText(['19'], { timeout: 12_000 });
});

// In un campo modificabile ogni riga è un nodo suo e il testo del campo le attacca: al modello e alle date le righe
// arrivano separate, e i segni restano sulla parola.
test('campo modificabile su più righe: i controlli leggono le righe separate, non attaccate', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = PAGINA.replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>',
    '<div id="ce" contenteditable="true" style="width:760px;min-height:140px;border:1px solid #999;font:22px sans-serif"></div>');
  const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'), html);
  await page.locator('#ce').click();
  await page.keyboard.type('ci vediamo venerdì 1');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2 ottobre? sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const testo = await app.evaluate(() => globalThis.__ocra.join('\n'));
  expect(testo).toContain('ci vediamo venerdì 1\n2 ottobre?');
  expect(testo).toContain('sì ci vediamo mercoledì');
  // Attaccate, «venerdì 1» e «2 ottobre» farebbero «venerdì 12 ottobre», che è lunedì.
  const b = await riquadroDelSegno(ocra(page).first());
  const v = await page.evaluate(() => {
    const w = document.createTreeWalker(document.getElementById('ce'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.nodeValue.indexOf('mercoledì');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 9);
      return r.getBoundingClientRect().toJSON();
    }
    return null;
  });
  expect({ dx: Math.abs(b.x - v.x) < 3, dy: Math.abs(b.y - v.y) < 3 }).toEqual({ dx: true, dy: true });
});

// La pagina sposta il campo senza scorrere (un avviso che compare sopra): i segni lo seguono.
for (const [nome, campo] of [
  ['casella di testo', null],
  ['campo modificabile', '<div id="ce" contenteditable="true" style="width:760px;min-height:140px;border:1px solid #999;font:22px sans-serif"></div>'],
]) {
  test(`${nome}: qualcosa compare sopra il campo e i puntini lo seguono`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    let html = PAGINA.replace('<main>', '<main><div id="sopra"></div>');
    if (campo) html = html.replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>', campo);
    const sel = campo ? '#ce' : '#ta';
    const page = await apri(app, openTab, testServer, contraddizione('ci vediamo martedì?'), html);
    await page.locator(sel).click();
    await page.keyboard.type('sì ci vediamo mercoledì');
    await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
    const distanza = () => page.evaluate((sel) => Math.round(document.querySelector('.sn-spell-overlay .sn-suggerimento').getBoundingClientRect().y
      - document.querySelector(sel).getBoundingClientRect().y), sel);
    const prima = await distanza();
    await page.evaluate(() => { document.getElementById('sopra').innerHTML = '<div style="height:50px">Anna sta scrivendo…</div>'; });
    await expect.poll(distanza, { timeout: 3000 }).toBe(prima);
  });
}
