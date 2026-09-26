// #686 — LO ZOOM DELLA PAGINA SI CHIEDE ANCHE A PAROLE.
//
// Prima esisteva solo come scorciatoia (Ctrl +/-/0) e voce di menu: alla chat
// mancava lo strumento, e «ingrandisci la pagina» finiva sulla dimensione del
// testo dell'interfaccia, che è un'altra cosa. Qui si guarda il risultato che
// l'utente vede: la pagina che sta davanti cambia davvero misura, l'ha capito
// dal numero che Filo riferisce, e la strada dei tasti e quella della chat
// condividono lo stesso zoom (e la stessa memoria per sito).
//
// Senza il fix: l'azione non è registrata → il dispatch la rifiuta e lo zoom
// non si muove di un millimetro.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head>
<body><h1>una pagina qualunque</h1><p>testo da ingrandire</p></body></html>`;

// Esegue un'azione Filo nel main, come farebbe la chat della home.
const execAction = (app, action) =>
  app.evaluate((_electron, { action }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action), { action });

async function zoomFactorOf(app, needle) {
  return app.evaluate(({ webContents }, n) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes(n)) return wc.getZoomFactor();
    }
    return null;
  }, needle);
}

const percentOf = async (app, needle) => Math.round((await zoomFactorOf(app, needle)) * 100);

test('«zoom al 150%»: la pagina davanti ci arriva, e Filo riferisce il numero vero', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  expect(await percentOf(app, '127.0.0.1')).toBe(100);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(150);
  expect(r.output.limitato).toBe(false);

  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(150);
});

test('«un po\' più grande», «più piccolo», «torna normale»: gli stessi passi dei tasti', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);

  const su = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'in' });
  expect(su.executed).toBe(true);
  expect(su.output.percentuale).toBeGreaterThan(100);
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(su.output.percentuale);

  // Un passo indietro riporta dove si era: ciò che si aggiunge si può togliere.
  const giu = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'out' });
  expect(giu.output.percentuale).toBe(100);
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(100);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 175 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(175);
  const reset = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  expect(reset.output.percentuale).toBe(100);
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(100);
});

test('un valore fuori scala si ferma al limite e lo DICE (niente taglio muto)', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 900 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(500);
  expect(r.output.limitato).toBe(true);
  expect(r.output.richiesto).toBe(900);
  expect(r.output.max).toBe(500);
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(500);
});

test('una richiesta senza niente dentro non muove lo zoom', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(125);

  for (const a of [
    { type: 'ZOOM_PAGINA' },
    { type: 'ZOOM_PAGINA', verso: '' },
    { type: 'ZOOM_PAGINA', verso: '   ' },
    { type: 'ZOOM_PAGINA', verso: 'più grande' },
    { type: 'ZOOM_PAGINA', percentuale: 'tanto' },
    { type: 'ZOOM_PAGINA', percentuale: '<b>200</b>' },
    { type: 'ZOOM_PAGINA', percentuale: 0 },
    { type: 'ZOOM_PAGINA', percentuale: -300 },
    { type: 'ZOOM_PAGINA', percentuale: '🔍' },
    { type: 'ZOOM_PAGINA', percentuale: 'x'.repeat(5000) },
  ]) {
    const r = await execAction(app, a);
    expect(r.executed, JSON.stringify(a)).toBe(false);
  }
  // Lo zoom di prima è ancora quello: un argomento sbagliato non azzera niente.
  expect(await percentOf(app, '127.0.0.1')).toBe(125);
});

test('chat e tasti sono lo stesso zoom: il tasto riparte da dove l\'ha lasciato la chat', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(150);

  // Ctrl+0 dalla PAGINA (la strada dei tasti) deve riportare al 100% ciò che la
  // chat ha zoomato: se i due cammini tenessero due zoom diversi, qui uno dei
  // due resterebbe indietro.
  await page.locator('h1').click();
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(100);

  // E viceversa: dopo un passo coi tasti, la chat riparte da lì e non da 100.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBeGreaterThan(100);
  const dopoTasto = await percentOf(app, '127.0.0.1');
  const r = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'in' });
  expect(r.output.percentuale).toBeGreaterThan(dopoTasto);
});

test('lo zoom chiesto in chat resta sul sito: una scheda nuova sullo stesso sito nasce zoomata', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(150);

  // Stessa origine, scheda nuova: la memoria per sito è quella dei tasti, e
  // vale anche per lo zoom chiesto a parole.
  const seconda = await testServer.openReady(openTab, PAGINA.replace('zoom', 'zoom2'));
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(150);
  expect(await seconda.evaluate(() => 1)).toBe(1);
});

test('lo stato della chat porta il livello di zoom della scheda davanti', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(125);

  const stato = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);
  expect(stato).toContain('ZOOM DELLA PAGINA');
  expect(stato).toMatch(/Scheda davanti: 125%/);
});

test('tasto destro: quando la pagina non è al 100% il menu lo dice e riporta alla dimensione reale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  // Al 100% la voce non c'è: il menu non si allunga per dire «va tutto bene».
  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('#__filo-context-menu')).toBeVisible();
  await expect(page.locator('#__filo-context-menu', { hasText: 'Dimensione reale' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(150);

  await page.locator('h1').click({ button: 'right' });
  const voce = page.locator('#__filo-context-menu').getByText(/Dimensione reale \(ora 150%\)/);
  await expect(voce).toBeVisible();

  // E il clic la riporta davvero al 100%: la voce è anche la via d'uscita.
  await voce.click();
  await expect.poll(async () => percentOf(app, '127.0.0.1')).toBe(100);
});
