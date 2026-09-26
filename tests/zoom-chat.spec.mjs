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

// Esegue un'azione Filo nel main COL MITTENTE, come fa la chat della home:
// senza, l'azione ripiegherebbe sulla prima finestra e la prova resterebbe
// verde anche se la strada vera fosse rotta (patterns/lo-stato-che-dura…).
const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

// La percentuale di zoom di UNA pagina precisa: le schede del test stanno tutte
// sullo stesso host, quindi si cerca per URL intero e non per host.
async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

test('«zoom al 150%»: la pagina davanti ci arriva, e Filo riferisce il numero vero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  expect(await percentOf(app, page)).toBe(100);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(150);
  expect(r.output.limitato).toBe(false);

  await expect.poll(async () => percentOf(app, page)).toBe(150);
});

test('«un po\' più grande», «più piccolo», «torna normale»: gli stessi passi dei tasti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  const su = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'in' });
  expect(su.executed).toBe(true);
  expect(su.output.percentuale).toBeGreaterThan(100);
  await expect.poll(async () => percentOf(app, page)).toBe(su.output.percentuale);

  // Un passo indietro riporta dove si era: ciò che si aggiunge si può togliere.
  const giu = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'out' });
  expect(giu.output.percentuale).toBe(100);
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 175 });
  await expect.poll(async () => percentOf(app, page)).toBe(175);
  const reset = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  expect(reset.output.percentuale).toBe(100);
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

test('un valore fuori scala si ferma al limite e lo DICE (niente taglio muto)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 900 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(500);
  expect(r.output.limitato).toBe(true);
  expect(r.output.richiesto).toBe(900);
  expect(r.output.max).toBe(500);
  await expect.poll(async () => percentOf(app, page)).toBe(500);
});

test('una richiesta senza niente dentro non muove lo zoom', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  await expect.poll(async () => percentOf(app, page)).toBe(125);

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
  expect(await percentOf(app, page)).toBe(125);
});

test('chat e tasti sono lo stesso zoom: il tasto riparte da dove l\'ha lasciato la chat', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  // Ctrl+0 dalla PAGINA (la strada dei tasti) deve riportare al 100% ciò che la
  // chat ha zoomato: se i due cammini tenessero due zoom diversi, qui uno dei
  // due resterebbe indietro.
  await page.locator('h1').click();
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  // E viceversa: dopo un passo coi tasti, la chat riparte da lì e non da 100.
  await page.keyboard.press('Control+=');
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  const dopoTasto = await percentOf(app, page);
  const r = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'in' });
  expect(r.output.percentuale).toBeGreaterThan(dopoTasto);
});

test('lo zoom chiesto in chat resta sul sito: una scheda nuova sullo stesso sito nasce zoomata', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  // Stessa origine, scheda nuova: la memoria per sito è quella dei tasti, e
  // vale anche per lo zoom chiesto a parole.
  const seconda = await testServer.openReady(openTab, PAGINA.replace('<h1>', '<h1 id="due">'));
  await expect.poll(async () => percentOf(app, seconda)).toBe(150);
});

test('lo stato della chat porta il livello di zoom della scheda davanti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  await expect.poll(async () => percentOf(app, page)).toBe(125);

  const stato = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);
  expect(stato).toContain('ZOOM DELLA PAGINA');
  expect(stato).toMatch(/Scheda davanti: 125%/);
});

test('tasto destro: quando la pagina non è al 100% il menu lo dice e riporta alla dimensione reale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  // Al 100% la voce non c'è: il menu non si allunga per dire «va tutto bene».
  await page.locator('h1').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu').getByText(/Dimensione reale/)).toHaveCount(0);
  await page.keyboard.press('Escape');

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  await page.locator('h1').click({ button: 'right' });
  const voce = page.locator('.sn-menu').getByText(/Dimensione reale \(ora 150%\)/);
  await expect(voce).toBeVisible();
  // La scorciatoia accanto alla voce è quella vera, chiesta al registro dei
  // tasti: due strade per la stessa cosa devono dirsi anche con lo stesso nome.
  const riga = page.locator('.sn-menu-item', { hasText: 'Dimensione reale' });
  await expect(riga.locator('.sn-menu-shortcut')).toHaveText(/Ctrl\+0/);

  // E il clic la riporta davvero al 100%: la voce è anche la via d'uscita.
  await voce.click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

// ── Lo zoom è dell'utente, non del sito (#686, primo giro di verifica) ──────
// Il menu del tasto destro deve sapere a quanto sta lo zoom e saperlo azzerare.
// Finché se lo diceva con un segnale dentro il documento, la stessa porta era
// aperta al sito: bastavano due righe di JavaScript per rimettere la pagina
// alla dimensione reale, o per dichiararsi «mi zoomo da solo» e sottrarsi del
// tutto — e in quel secondo caso Filo rispondeva anche «fatto» a una pagina
// rimasta ferma. Un sito che non vuole essere ingrandito non deve poterlo
// impedire a chi ha bisogno di leggere grande.

const SITO_CHE_RIMETTE = `<!doctype html><html><head><meta charset="utf-8"><title>ostile</title></head>
<body><h1>niente zoom qui</h1><script>
  window.__rimetti = () => { document.dispatchEvent(new Event('filo:zoom-azzera')); };
</script></body></html>`;

const SITO_CHE_SI_FINGE_EDITOR = `<!doctype html><html><head><meta charset="utf-8"><title>finto editor</title></head>
<body><h1>niente zoom qui</h1><script>
  document.documentElement.dataset.filoOwnZoom = '1';
</script></body></html>`;

test('un sito non può rimettere al 100% lo zoom che l\'utente ha chiesto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO_CHE_RIMETTE);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.evaluate(() => window.__rimetti());
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'il sito ha riportato la pagina alla dimensione reale').toBe(200);
});

test('un sito non può sottrarsi allo zoom dichiarando di zoomarsi da sé', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO_CHE_SI_FINGE_EDITOR);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);
  // …e il numero riferito è quello vero, non un «fatto» senza percentuale.
  expect(r.output.zoom).toBe('ok');
  expect(r.output.percentuale).toBe(200);

  // Anche i tasti: la dichiarazione del sito non li spegne.
  await page.locator('h1').click();
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

test('anche una pagina di Filo si ingrandisce a parole, e il tasto destro ne mostra il livello', async ({ app, openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.output.percentuale).toBe(150);
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  await page.locator('body').click({ button: 'right', position: { x: 12, y: 12 } });
  const voce = page.locator('.sn-menu').first().getByText(/Dimensione reale \(ora 150%\)/);
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

// #686 (secondo giro) — I GESTI CHE MUOVONO LO ZOOM SONO QUELLI DELL'UTENTE.
// Un sito arriva agli stessi listener della tastiera e della rotella scrivendosi
// da solo un evento: così rimetteva la pagina alla misura che voleva subito dopo
// un «zoom al 200%», e poteva anche aprire da sé la modalità zoom della rotella.
// Senza il fix: questi tre casi riportano la pagina dove vuole il sito → rosso.
test('un sito non muove lo zoom fingendo i gesti dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);

  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    for (let i = 0; i < 40; i++) {
      document.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    }
    document.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  expect(await percentOf(app, page)).toBe(200);
  expect(await page.locator('#__filo-zoom-badge').count()).toBe(0);

  // I gesti veri continuano a funzionare: il freno è sul finto, non su tutti.
  await page.locator('h1').click();
  await page.keyboard.press('Control+0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

// #686 (secondo giro) — L'EDITOR SCALA IL FOGLIO, E IL NUMERO CHE FILO DICE È
// QUELLO DEL FOGLIO. Prima Filo leggeva il livello della finestra, fermo al
// 100%: subito dopo aver ingrandito il documento rispondeva «100%».
test('sull\'editor Filo riferisce lo zoom del foglio, non quello della finestra', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(150);
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('1.5');

  const testo = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);
  expect(testo).toMatch(/Scheda davanti: 150%/);

  // …e si torna indietro dalla chat come da ogni altra strada.
  await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  await expect.poll(async () => page.evaluate(() => document.getElementById('doc').style.zoom)).toBe('');
});
