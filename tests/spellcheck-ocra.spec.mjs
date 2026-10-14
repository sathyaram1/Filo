// #1115 — il terzo segno del correttore: i puntini ocra sotto ciò che non torna con la pagina. Una conversazione che
// parla di martedì e «sì ci vediamo mercoledì» nella casella: l'ocra sta su «mercoledì» e il tasto destro mostra la
// citazione; una citazione che nella pagina non c'è non lascia niente; le date le controlla il codice; ognuno dei due
// segni si spegne da solo, dalla pagina Altro. Il modello è finto: nessuna chiamata esce dalla macchina.

import { test, expect } from './fixtures/electron.mjs';

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

// `__ocraRisposta` è quello che il modello finto risponde al controllo di coerenza; il blu non trova mai niente.
async function apri(app, openTab, testServer, risposta) {
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    globalThis.__ocraRisposta = risposta;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) {
        globalThis.__ocra.push(messages[messages.length - 1].content);
        return fine(globalThis.__ocraRisposta);
      }
      if (t.includes('Analizza il testo qui sotto')) return fine('{"annotated":"","issues":[]}');
      return fine('{"misspelled":false,"correction":""}');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposta);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const ocra = (page) => page.locator('.sn-spell-overlay .sn-coerenza');
const chiamate = (app) => app.evaluate(() => globalThis.__ocra.length);
const contraddizione = (citazione) => JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione, spiegazione: 'Prima si era detto martedì.', correzione: 'martedì',
}] });

async function tastoDestroSu(page, segno) {
  const b = await segno.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = page.locator('.sn-menu');
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
  const [prompt] = await app.evaluate(() => globalThis.__ocra);
  expect(prompt).toContain('Anna: ciao! ci vediamo martedì?');
  expect(prompt).toContain('porto io i biglietti');
  expect(prompt.indexOf('porto io i biglietti')).toBeLessThan(prompt.indexOf('sì ci vediamo mercoledì'));
  expect(prompt).toMatch(/Oggi è \S+ \d{1,2} \S+ \d{4}/);

  const stile = await ocra(page).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { linea: cs.textDecorationLine, stile: cs.textDecorationStyle, colore: cs.textDecorationColor };
  });
  expect(stile).toEqual({ linea: 'underline', stile: 'dotted', colore: 'rgb(176, 122, 20)' });
  await page.screenshot({ path: 'tests/.shots/1115-ocra-contraddizione.png' }).catch(() => {});

  const menu = await tastoDestroSu(page, ocra(page).first());
  const riquadro = menu.locator('.sn-menu-coerenza');
  await expect(riquadro).toContainText('Prima si era detto martedì.');
  await expect(riquadro.locator('.sn-menu-coerenza-citazione')).toHaveText('prima: «ci vediamo martedì?»');
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
  await expect(menu.locator('.sn-menu-coerenza')).toHaveText('Il 9 ottobre 2026 è venerdì.');
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
  const blu = altro.locator('#spellcheckBlu');
  const giallo = altro.locator('#spellcheckOcra');
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

test('aspetto: ocra accanto al blu, anche sulla stessa parola, in tema chiaro e scuro', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, JSON.stringify({ issues: [
    { tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì' },
    { tipo: 'poco_chiara', testo: 'lui gli', citazione: '', spiegazione: 'Non si capisce chi porta cosa.', correzione: '' },
  ] }));
  // Il blu, finto anche lui: «sonno» al posto di «sono», e «mercoledì» per vedere i due segni sulla stessa parola.
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.completeWithFallback;
    const finto = async (req) => {
      if (JSON.stringify(req.messages).includes('Analizza il testo qui sotto')) {
        return { text: JSON.stringify({ annotated: 'ieri **sonno** stato da Marco, ciaoo, ci vediamo **mercoledì** e lui gli porta', issues: [
          { type: 'semantic', explanation: 'sono', correction: 'sono' }, { type: 'grammar', explanation: 'x', correction: 'martedì' },
        ] }), model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
      }
      return prima(req);
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  await page.locator('#ta').click();
  await page.keyboard.type('ieri sonno stato da Marco, ciaoo, ci vediamo mercoledì e lui gli porta');
  await expect(ocra(page)).toHaveText(['mercoledì', 'lui gli'], { timeout: 12_000 });
  await expect(page.locator('.sn-spell-overlay .sn-semantic-error')).toHaveText(['sonno', 'mercoledì'], { timeout: 6000 });
  const insieme = page.locator('.sn-spell-overlay .sn-semantic-error.sn-coerenza');
  await expect(insieme).toHaveText('mercoledì');
  const segni = () => insieme.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { zigzag: cs.backgroundImage !== 'none', puntini: cs.textDecorationStyle, colore: cs.textDecorationColor };
  });
  expect(await segni()).toEqual({ zigzag: true, puntini: 'dotted', colore: 'rgb(176, 122, 20)' });
  await page.locator('#ta').evaluate((el) => el.blur());
  await page.locator('#ta').focus();
  await page.screenshot({ path: 'tests/.shots/1115-ocra-chiaro.png', clip: { x: 0, y: 0, width: 820, height: 320 } }).catch(() => {});

  // Il tema cambiato a overlay aperto arriva ai segni senza dover battere un tasto.
  await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' });
  await page.evaluate(() => { document.body.style.background = '#1e1d1b'; document.body.style.color = '#e5e3dc'; });
  await expect.poll(segni, { timeout: 5000 }).toEqual({ zigzag: true, puntini: 'dotted', colore: 'rgb(226, 173, 77)' });
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
  expect(prompt).toContain('sì ci vediamo mercoledì e poi giovedì 9 ottobre 2026');
  await page.waitForTimeout(800);
  // La citazione sarebbe nella pagina, ma il modello la pagina non l'ha vista: la contraddizione non vale.
  await expect(ocra(page)).toHaveText(['giovedì 9 ottobre 2026']);
});
