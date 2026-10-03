// La password e i dati della carta che l'utente scrive in un modulo non partono verso il modello dell'assistente
// di pagina (#810.7): il campo arriva col suo nome e, nell'immagine, coperto dai puntini. Senza il fix è rossa: con
// l'etichetta legata al campo e nessun segnaposto, la descrizione degli elementi portava il valore in chiaro.

import { test, expect } from './fixtures/electron.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Risponde secondo l'ultimo messaggio dell'utente (`risposte`: [[parola, risposta]]); tutto ciò che arriva al
// modello resta in __visti.
async function modelloFinto(app, risposte) {
  await app.evaluate((_electron, risposte) => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__visti = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__visti.push(JSON.parse(JSON.stringify(messages)));
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: scelta[1] };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
  }, risposte);
}

async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}

async function scriviAllAiuto(page, testo) {
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

// Il testo arrivato al modello, senza l'indirizzo del server di prova e l'immagine della pagina: la porta e il
// base64 possono contenere per caso le cifre di un codice corto.
async function arrivato(app, page) {
  const testo = await app.evaluate(() => JSON.stringify(globalThis.__visti || []));
  return testo.split(new URL(page.url()).origin).join('').replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '');
}

function rigaDelCampo(testo) {
  return (testo.split('\\n').find((r) => r.includes(':: #c')) || '').replace(/\\"/g, '"');
}

// Su http un modulo con password o carta fa comparire l'avviso del sito sospetto, che rende la pagina inerte
// finché non si sceglie «Continua»: è quello che farebbe l'utente prima di scrivere.
async function superaAvviso(page) {
  const continua = page.getByRole('button', { name: 'Continua' });
  await expect(continua).toBeVisible({ timeout: 10_000 });
  await continua.click();
  await expect(continua).toHaveCount(0, { timeout: 6_000 });
}

const modulo = (campo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Area clienti</h1>
  <form><div>${campo}</div><button type="button">Accedi</button></form></body></html>`;

const SEGRETI = [
  { nome: 'la password sotto l’etichetta «Password»', campo: '<label for="c">Password</label> <input id="c" type="password">', valore: 'Gatto.Rosso.77', etichetta: 'Password', avviso: true },
  { nome: 'la password resa visibile dal sito', campo: '<label for="c">Password</label> <input id="c" type="text">', valore: 'Gatto.Rosso.77', etichetta: 'Password', avviso: true },
  { nome: 'il numero di carta senza segnaposto', campo: '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" inputmode="numeric">', valore: '4111 1111 1111 1111', etichetta: 'Numero della carta', avviso: true },
  { nome: 'il codice di sicurezza nella sua etichetta', campo: '<label>CVV <input id="c" inputmode="numeric"></label>', valore: '8264', etichetta: 'CVV', avviso: true },
  { nome: 'un codice che il sito copre coi puntini', campo: '<label for="c">Codice</label> <input id="c" style="-webkit-text-security:disc">', valore: 'Zq7Kp2xW', etichetta: 'Codice' },
];

for (const caso of SEGRETI) {
  test(`${caso.nome}: al modello arriva il campo col suo nome, non quello che c'è scritto`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(caso.campo));
    if (caso.avviso) await superaAvviso(page);
    await page.fill('#c', caso.valore);
    await expect(page.locator('#c')).toHaveValue(caso.valore);
    await preparaModelli(app);
    await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a entrare');
    await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });

    const testo = await arrivato(app, page);
    expect(testo, 'quello che l’utente ha scritto nel campo è arrivato al modello').not.toContain(caso.valore);
    expect(testo).not.toContain(caso.valore.replace(/\s/g, ''));
    expect(rigaDelCampo(testo), 'il modello deve sapere quale campo è').toContain(`"${caso.etichetta}`);
  });
}

test('un campo qualunque senza nome continua a farsi riconoscere da quello che c’è scritto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<input id="c">'));
  await page.fill('#c', 'biciclette rosse');
  await expect(page.locator('#c')).toHaveValue('biciclette rosse');
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a cercare');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });
  expect(rigaDelCampo(await arrivato(app, page))).toContain('"biciclette rosse"');
});

test('il clic sul campo della password indicato dall’assistente lo racconta col nome del campo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Password</label> <input id="c" type="password">'));
  await superaAvviso(page);
  await page.fill('#c', 'Gatto.Rosso.77');
  await expect(page.locator('#c')).toHaveValue('Gatto.Rosso.77');
  await preparaModelli(app);
  await modelloFinto(app, [
    ['cliccato', JSON.stringify({ text: 'Ora premi «Accedi».', status: 'done' })],
    ['', JSON.stringify({ text: 'Controlla la password.', highlight: { selector: '#c', action: 'click', note: 'qui' }, status: 'continue' })],
  ]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a entrare');
  await expect(page.locator('.sn-sidebar', { hasText: 'Controlla la password.' })).toBeVisible({ timeout: 20_000 });
  await page.click('#c');
  await expect(page.locator('.sn-sidebar', { hasText: 'Ora premi «Accedi».' })).toBeVisible({ timeout: 20_000 });

  await expect(page.locator('.sn-sidebar-log', { hasText: 'click su Password' })).toBeVisible();
  await expect(page.locator('.sn-sidebar')).not.toContainText('Gatto.Rosso.77');
  expect(await arrivato(app, page)).not.toContain('Gatto.Rosso.77');
});

// Il tasto destro su una parola di un campo di testo chiede al modello la correzione, con tutto il campo intorno:
// in una password resa visibile dal sito la mandava intera.
test('il tasto destro sulla password resa visibile non la manda alla correzione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Password</label> <input id="c" type="text"> '
    + '<label for="n">Note per la consegna</label> <input id="n">'));
  await superaAvviso(page);
  await page.fill('#c', 'Gatto.Rosso.77');
  await page.fill('#n', 'consegnaa domani');
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ misspelled: false })]]);

  await page.locator('#c').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#n').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect.poll(() => arrivato(app, page), { timeout: 15_000 }).toContain('consegnaa');
  expect(await arrivato(app, page)).not.toContain('Gatto');
});

// Il numero della carta a schermo si legge: nell'immagine della pagina che va al modello il campo arriva coperto dai
// puntini, quindi due numeri diversi danno la stessa immagine.
test('nell’immagine della pagina che va al modello il numero della carta è coperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Numero della carta</label> '
    + '<input id="c" autocomplete="cc-number" style="width:280px;font-size:18px">'));
  await superaAvviso(page);
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);

  const immagini = [];
  for (const [i, valore] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await page.fill('#c', valore);
    await scriviAllAiuto(page, 'aiutami a pagare');
    await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBe(i + 1);
    immagini.push(await app.evaluate(() => {
      const utente = [...globalThis.__visti.at(-1)].reverse().find((m) => m.role === 'user');
      const parte = Array.isArray(utente.content) && utente.content.find((p) => p.type === 'image_url');
      return parte ? parte.image_url.url : null;
    }));
  }
  expect(immagini[0], 'al modello deve arrivare l’immagine della pagina').toMatch(/^data:image\//);
  expect(immagini[1]).toMatch(/^data:image\//);

  // Dentro il bordo: il bordo e l'anello del fuoco cambiano col campo attivo, e non dicono niente del numero.
  const diversi = await page.evaluate(async ([a, b]) => {
    const campo = document.querySelector('#c');
    const b0 = campo.getBoundingClientRect();
    const cs = getComputedStyle(campo);
    const l = parseFloat(cs.borderLeftWidth) + 1, t = parseFloat(cs.borderTopWidth) + 1;
    const r = { left: b0.left + l, top: b0.top + t, width: b0.width - 2 * l, height: b0.height - 2 * t };
    const pixel = async (url) => {
      const byte = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([byte]));
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const sx = img.width / window.innerWidth, sy = img.height / window.innerHeight;
      return ctx.getImageData(Math.round(r.left * sx), Math.round(r.top * sy), Math.round(r.width * sx), Math.round(r.height * sy)).data;
    };
    const [pa, pb] = [await pixel(a), await pixel(b)];
    let n = 0;
    for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
    return n;
  }, immagini);
  expect(diversi, 'il numero scritto nel campo si vede nell’immagine').toBe(0);
});
