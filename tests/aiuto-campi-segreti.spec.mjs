// La password e i dati della carta che l'utente scrive in un modulo non partono verso il modello dell'assistente
// di pagina (#810.7): il campo arriva col suo nome e, nell'immagine, coperto dai puntini. Senza il fix è rossa: con
// l'etichetta legata al campo e nessun segnaposto, la descrizione degli elementi portava il valore in chiaro.

import { test, expect } from './fixtures/electron.mjs';
import { vistaAvviso, copertura } from './helpers/avvisoSito.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
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

// Su http un modulo con password o carta fa comparire l'avviso del sito sospetto, in una vista sopra la scheda che
// la rende inerte finché non si sceglie «Continua»: è quello che farebbe l'utente prima di scrivere. Senza
// `obbligatorio` si supera solo se c'è: compare secondo i campi che la pagina dichiara.
async function superaAvviso(app, { obbligatorio = true } = {}) {
  const coperta = async () => (await copertura(app).catch(() => null))?.coperta === true;
  const fine = Date.now() + (obbligatorio ? 10_000 : 4_000);
  while (!(await coperta())) {
    if (Date.now() > fine) {
      if (obbligatorio) throw new Error('l’avviso del sito sospetto non è comparso');
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const avviso = await vistaAvviso(app);
  await avviso.getByRole('button', { name: 'Continua' }).click();
  await expect.poll(coperta, { timeout: 6_000 }).toBe(false);
}

const modulo = (campo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Area clienti</h1>
  <form><div>${campo}</div><button type="button">Accedi</button></form></body></html>`;

const SEGRETI = [
  { nome: 'la password sotto l’etichetta «Password»', campo: '<label for="c">Password</label> <input id="c" type="password">', valore: 'Gatto.Rosso.77', etichetta: 'Password', avviso: true },
  { nome: 'la password resa visibile dal sito', campo: '<label for="c">Password</label> <input id="c" type="text">', valore: 'Gatto.Rosso.77', etichetta: 'Password', avviso: true },
  { nome: 'il numero di carta senza segnaposto', campo: '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" inputmode="numeric">', valore: '4111 1111 1111 1111', etichetta: 'Numero della carta', avviso: true },
  { nome: 'il codice di sicurezza nella sua etichetta', campo: '<label>CVV <input id="c" inputmode="numeric"></label>', valore: '8264', etichetta: 'CVV', avviso: true },
  { nome: 'un codice che il sito copre coi puntini', campo: '<label for="c">Codice</label> <input id="c" style="-webkit-text-security:disc">', valore: 'Zq7Kp2xW', etichetta: 'Codice' },
  { nome: 'il numero di carta in un campo che il sito chiama solo «cc-number»', campo: '<div>Numero della carta</div><input id="c" name="cc-number">', valore: '4111 1111 1111 1111', etichetta: '' },
  { nome: 'il numero di carta in un campo dal nome qualunque', campo: '<input id="c" name="q">', valore: '5500 0000 0000 0004', etichetta: '' },
  { nome: 'il numero di carta con una cifra sbagliata in un campo dal nome qualunque', campo: '<div>Numero della carta</div><input id="c" name="number">', valore: '4111 1111 1111 1112', etichetta: '' },
];

for (const caso of SEGRETI) {
  test(`${caso.nome}: al modello arriva il campo col suo nome, non quello che c'è scritto`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, modulo(caso.campo));
    if (caso.avviso) await superaAvviso(app);
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
    expect(rigaDelCampo(testo), 'il campo deve restare nell’elenco').toContain(':: #c');
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
  await superaAvviso(app);
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
  await superaAvviso(app);
  await page.fill('#c', 'Gatto.Rosso.77');
  await page.fill('#n', 'consegnaa domani');
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ misspelled: false })]]);

  await page.locator('#c').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
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
  await superaAvviso(app);
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

// Quante cifre cambiano fra due immagini della pagina dentro il rettangolo r: zero vuol dire che il numero non si legge.
async function pixelDiversi(page, [a, b], r) {
  return page.evaluate(async ([a, b, r]) => {
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
  }, [a, b, r]);
}

async function immaginiConDueCarte(app, shell, page, scrivi) {
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  const immagini = [];
  for (const [i, valore] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await scrivi(valore);
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
  return immagini;
}

// Il campo della carta di un servizio di pagamento sta in un riquadro di un altro sito, che la pagina non vede.
test('nell’immagine che va al modello è coperto anche il numero scritto nel riquadro di pagamento di un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <input id="n" autocomplete="cc-number" placeholder="1234 1234 1234 1234"
      style="width:300px;font-size:20px;border:0;outline:0;caret-color:transparent"></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab,
    modulo(`<label>Carta</label><iframe id="f" src="${riquadro}" style="width:340px;height:40px;border:0;padding:4px"></iframe>`));
  const campo = page.frameLocator('#f').locator('#n');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  const immagini = await immaginiConDueCarte(app, shell, page, (v) => campo.fill(v));
  const f = await page.locator('#f').boundingBox();
  expect(await pixelDiversi(page, immagini, { left: f.x + 4, top: f.y + 4, width: 300, height: f.height - 8 }),
    'il numero scritto nel riquadro di pagamento si legge nell’immagine').toBe(0);
});

test('nell’immagine è coperto il numero di carta anche quando il campo si chiama solo «Numero»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo('<fieldset><legend>Carta di credito</legend><label for="c">Numero</label> '
    + '<input id="c" name="number" style="width:300px;font-size:18px;outline:0;caret-color:transparent"></fieldset>'));
  const immagini = await immaginiConDueCarte(app, shell, page, (v) => page.fill('#c', v));
  const b = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, immagini, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 }),
    'il numero scritto nel campo si legge nell’immagine').toBe(0);
});

// Selezionare del testo prepara la spiegazione del tasto destro: dentro il campo della carta non deve partire niente,
// e il menu sulla selezione tiene Taglia e Copia ma non la spiegazione. Un campo che non dice d'essere della carta: una
// pagina che lo dice è delicata, e lì le chiamate automatiche si fermano tutte, anche quella del campo di prova.
test('il numero di carta selezionato nel suo campo non parte verso la spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<input id="c" name="q" style="width:280px"> '
    + '<label for="n">Note</label> <input id="n" style="width:280px">'));
  await superaAvvisoSeCe(app);
  await page.fill('#c', '4111 1111 1111 1111');
  await page.fill('#n', 'consegna al portone verde');
  await preparaModelli(app);
  await modelloFinto(app, [['', 'Una frase.']]);

  await page.locator('#c').click();
  await page.keyboard.press('Control+a');
  await page.locator('#c').click({ button: 'right', position: { x: 12, y: 8 } });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Copia', { exact: true })).toBeVisible();
  await expect(menu.locator('.sn-menu-inline-explain')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Un campo qualunque, selezionato allo stesso modo, la spiegazione la chiede: è la prova che il tempo è bastato.
  await page.locator('#n').click();
  await page.keyboard.press('Control+a');
  await expect.poll(() => arrivato(app, page), { timeout: 15_000 }).toContain('portone verde');
  expect(await arrivato(app, page), 'il numero di carta selezionato è partito verso il modello').not.toContain('4111');
});

const superaAvvisoSeCe = (app) => superaAvviso(app, { obbligatorio: false });

const QUATTRO_CASELLE = '<label for="k1">Numero della carta</label> '
  + [1, 2, 3, 4].map((i) => `<input id="k${i}" maxlength="4" inputmode="numeric" style="width:70px;font-size:18px;outline:0;caret-color:transparent">`).join(' ');

// Molti moduli dividono il numero della carta in quattro caselle, e il codice monouso in sei: l'etichetta o
// l'autocompletamento stanno su una casella sola, ma il segreto è di tutte.
test('la carta divisa in quattro caselle non arriva al modello, né nella descrizione né nell’immagine', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo(QUATTRO_CASELLE));
  await superaAvvisoSeCe(app);
  const immagini = await immaginiConDueCarte(app, shell, page, async (v) => {
    const pezzi = v.split(' ');
    for (let i = 0; i < 4; i++) await page.fill(`#k${i + 1}`, pezzi[i]);
  });
  const testo = await arrivato(app, page);
  const righe = testo.split('\\n').filter((r) => /:: #k[1-4]/.test(r));
  expect(righe.length, 'le quattro caselle devono restare nell’elenco').toBeGreaterThanOrEqual(4);
  expect(righe.join('\n'), 'le cifre della carta sono arrivate al modello').not.toMatch(/5500|0004|4111/);
  for (const id of ['#k2', '#k4']) {
    const b = await page.locator(id).boundingBox();
    expect(await pixelDiversi(page, immagini, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 }),
      `le cifre di ${id} si leggono nell’immagine`).toBe(0);
  }
});

test('il codice monouso diviso in sei caselle non arriva al modello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const caselle = [1, 2, 3, 4, 5, 6].map((i) => `<input id="o${i}" maxlength="1" inputmode="numeric" style="width:24px">`).join('');
  const page = await testServer.openReady(openTab, modulo(`<p>Inserisci il codice che ti abbiamo mandato</p>${caselle}`));
  await superaAvvisoSeCe(app);
  for (const [i, c] of [...'739146'].entries()) await page.fill(`#o${i + 1}`, c);
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a entrare');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });
  const righe = (await arrivato(app, page)).split('\\n').filter((r) => /:: #o[1-6]/.test(r));
  expect(righe).toHaveLength(6);
  expect(righe.join('\n'), 'le cifre del codice sono arrivate al modello').not.toMatch(/input \\"\d\\"/);
});

// Le parti che un sito incapsula in un componente si vedono a schermo come le altre.
test('nell’immagine è coperto il numero di carta scritto in un campo dentro un componente della pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo(`<carta-pagamento></carta-pagamento><script>
    customElements.define('carta-pagamento', class extends HTMLElement { constructor() { super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<label for="c">Numero della carta</label> '
        + '<input id="c" autocomplete="cc-number" style="width:300px;font-size:18px;outline:0;caret-color:transparent">'; } });
  </script>`));
  await superaAvvisoSeCe(app);
  const campo = page.locator('carta-pagamento input');
  const immagini = await immaginiConDueCarte(app, shell, page, (v) => campo.fill(v));
  const b = await campo.boundingBox();
  expect(await pixelDiversi(page, immagini, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 }),
    'il numero scritto nel componente si legge nell’immagine').toBe(0);
});

// Un componente chiuso non lo vedono né la pagina né il content script di Filo, ma a schermo si vede come gli altri.
const componenteChiuso = `<carta-chiusa></carta-chiusa><script>
  customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
    const r = this.attachShadow({ mode: 'closed' }); window.__radice = r;
    r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" '
      + 'style="width:280px;font-size:18px;outline:0;caret-color:transparent">'; } });
</script>`;

async function scriviNelComponente(frame, valore) {
  await frame.evaluate((v) => { window.__radice.querySelector('input').value = v; }, valore);
}

async function campoNelComponente(frame, scostamento = { x: 0, y: 0 }) {
  const b = await frame.evaluate(() => {
    const r = window.__radice.querySelector('input').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  return { left: b.left + scostamento.x + 3, top: b.top + scostamento.y + 3, width: b.width - 6, height: b.height - 6 };
}

test('nell’immagine è coperto il numero di carta scritto in un campo dentro un componente chiuso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo(componenteChiuso));
  await superaAvvisoSeCe(app);
  const immagini = await immaginiConDueCarte(app, shell, page, (v) => scriviNelComponente(page, v));
  expect(await pixelDiversi(page, immagini, await campoNelComponente(page)),
    'il numero scritto nel componente chiuso si legge nell’immagine').toBe(0);
});

// Lo stesso componente in un riquadro del sito stesso e in uno di un altro sito, che vive in un processo suo.
test('nell’immagine è coperto il numero di carta del componente chiuso anche dentro i riquadri', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const doc = `<!doctype html><html><body style="margin:0;background:#fff">${componenteChiuso}</body></html>`;
  const fuori = testServer.html(doc, { pubblico: true });
  const stile = 'width:420px;height:60px;border:3px solid #888;padding:5px';
  const page = await testServer.openReady(openTab, modulo(`<iframe name="stesso" srcdoc="${doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="${stile}"></iframe>`
    + `<iframe name="altro" src="${fuori}" style="${stile}"></iframe>`));
  await superaAvvisoSeCe(app);
  const riquadri = ['stesso', 'altro'];
  await expect.poll(() => Promise.all(riquadri.map((n) => page.frame({ name: n })?.evaluate(() => Boolean(window.__radice)).catch(() => false))),
    { timeout: 10_000 }).toEqual([true, true]);
  const immagini = await immaginiConDueCarte(app, shell, page,
    (v) => Promise.all(riquadri.map((n) => scriviNelComponente(page.frame({ name: n }), v))));
  for (const n of riquadri) {
    const f = await page.locator(`iframe[name="${n}"]`).boundingBox();
    const r = await campoNelComponente(page.frame({ name: n }), { x: f.x + 3 + 5, y: f.y + 3 + 5 });
    expect(await pixelDiversi(page, immagini, r), `il numero del componente chiuso nel riquadro «${n}» si legge nell’immagine`).toBe(0);
  }
});

// Una password che il sito rende visibile resta una password anche se il campo ha un nome qualunque e la scritta
// accanto non è legata né dice «password» in una lingua che Filo conosce.
test('la password resa visibile dal sito non arriva al modello, né nella descrizione né nell’immagine', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo('<div>Hasło</div><input id="c" name="haslo" type="password" '
    + 'style="width:300px;font-size:18px;outline:0;caret-color:transparent"> '
    + '<button type="button" id="occhio" onclick="c.type = c.type === \'password\' ? \'text\' : \'password\'">Mostra</button>'));
  await superaAvvisoSeCe(app);
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  const immagini = [];
  for (const [i, valore] of ['Gatto.Rosso.77', 'Mela.Verde.42'].entries()) {
    if (i) await page.click('#occhio');
    await expect(page.locator('#c')).toHaveAttribute('type', 'password');
    await page.fill('#c', valore);
    await page.click('#occhio');
    await expect(page.locator('#c')).toHaveAttribute('type', 'text');
    await scriviAllAiuto(page, 'non riesco ad entrare');
    await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBe(i + 1);
    immagini.push(await app.evaluate(() => {
      const utente = [...globalThis.__visti.at(-1)].reverse().find((m) => m.role === 'user');
      const parte = Array.isArray(utente.content) && utente.content.find((p) => p.type === 'image_url');
      return parte ? parte.image_url.url : null;
    }));
  }
  const testo = await arrivato(app, page);
  expect(testo, 'la password è arrivata al modello').not.toMatch(/Gatto\.Rosso|Mela\.Verde/);
  expect(rigaDelCampo(testo), 'il modello deve sapere quale campo è').toContain('"Hasło"');
  expect(immagini[1]).toMatch(/^data:image\//);
  const b = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, immagini, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 }),
    'la password si legge nell’immagine').toBe(0);
});

// Un campo senza nome si chiama con la scritta che lo precede, non con quello che l'utente ci ha scritto: un codice
// monouso in un campo solo arrivava al modello come nome del campo.
test('il codice monouso in un campo solo arriva al modello col testo che lo precede, non con le cifre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<p>Inserisci il codice che ti abbiamo mandato via SMS</p>'
    + '<input id="c" maxlength="6" inputmode="numeric">'));
  await superaAvvisoSeCe(app);
  await page.fill('#c', '739146');
  await preparaModelli(app);
  await modelloFinto(app, [['', JSON.stringify({ text: 'Premi «Accedi».', status: 'done' })]]);
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'non funziona');
  await expect(page.locator('.sn-sidebar', { hasText: 'Premi «Accedi».' })).toBeVisible({ timeout: 20_000 });
  const testo = await arrivato(app, page);
  expect(testo, 'il codice è arrivato al modello').not.toContain('739146');
  expect(rigaDelCampo(testo)).toContain('"Inserisci il codice che ti abbiamo mandato via SMS"');
});

// La ricerca dei campi nei componenti chiusi legge l'albero intero solo dove ce n'è uno con dei campi: su una pagina
// grande prima costava secondi a ogni foto, con Filo fermo per più di un secondo alla volta.
test('su una pagina grande senza componenti chiusi la foto per l’assistente non aspetta e Filo non si ferma', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
    ${'<div><span>x</span><a href="#">y</a></div>'.repeat(2000)}<p>r${i}</p></body></html>`, { pubblico: true }));
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Lunga</title></head><body>
    <form><input name="q" value="scarpe da corsa"> <textarea>una nota</textarea></form>
    <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(13000));</script>
    ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
  await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(15);
  await apriAiuto(shell, page);
  const percorso = new URL(page.url()).pathname;

  const esito = await app.evaluate(async ({ webContents }, percorso) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const durate = [];
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      const r = await M.campiSegretiFuoriPagina(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, percorso);

  expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
  expect(Math.max(...esito.durate.map((d) => d.ms)), 'ogni foto dell’assistente aspetta la ricerca dei campi').toBeLessThan(1000);
  expect(esito.fermo, 'Filo resta fermo mentre cerca i campi').toBeLessThan(300);
});

// Lo screenshot del menu: il nome del file lo sceglie un modello guardando la foto. La foto dell'utente resta intera.
async function screenshotDellUtente(app, page) {
  let foto = null;
  await expect.poll(async () => {
    await page.mouse.click(5, 5);
    foto = await app.evaluate(async ({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
      const tab = tm.tabs.find((t) => t.title === 'Accesso');
      return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(async () => {
        HTMLAnchorElement.prototype.click = function () { window.__foto = this.href; };
        window.__foto = null;
        await SN_ACTIONS.takeScreenshot();
        return window.__foto;
      })()` }], true);
    });
    return Boolean(foto);
  }, { timeout: 20_000 }).toBe(true);
  return foto;
}

test('lo screenshot di una pagina col numero di carta scritto arriva coperto al modello che sceglie il nome del file', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo('<div>Numero della carta</div> '
    + '<input id="c" name="number" style="width:280px;font-size:18px">'));
  await superaAvvisoSeCe(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models }, modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
  });
  await modelloFinto(app, [['', 'Pagamento con carta']]);

  const foto = [];
  for (const valore of ['4111 1111 1111 1111', '5500 0000 0000 0004']) {
    await page.fill('#c', valore);
    await app.evaluate(() => globalThis.SN_AI_CACHE.clear());
    const prima = await app.evaluate(() => globalThis.__visti.length);
    const utente = await screenshotDellUtente(app, page);
    const alModello = await app.evaluate((_electron, n) => {
      const nuove = globalThis.__visti.slice(n);
      const parte = nuove.flatMap((m) => m).flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((p) => p.type === 'image_url');
      return parte ? parte.image_url.url : null;
    }, prima);
    expect(alModello, 'la foto deve arrivare al modello del nome').toMatch(/^data:image\//);
    foto.push({ utente, alModello });
  }
  const r = await page.evaluate(() => {
    const b = document.querySelector('#c').getBoundingClientRect();
    return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 };
  });
  expect(await pixelDiversi(page, [foto[0].alModello, foto[1].alModello], r), 'il numero si legge nella foto per il modello').toBe(0);
  expect(await pixelDiversi(page, [foto[0].utente, foto[1].utente], r), 'lo screenshot dell’utente resta com’è').toBeGreaterThan(0);
});
