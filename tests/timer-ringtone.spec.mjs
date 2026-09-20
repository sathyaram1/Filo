// Feature: suoneria del timer.
//
// Verifica:
// (a) Alla scadenza di un timer, il contenitore live mostra data-ringing="1"
//     (stato "squilla" osservabile senza audio, perché WebAudio non suona
//     in ambiente headless — ma la presenza dello stato è testabile).
// (b) Il timer rimane visibile dopo la scadenza (non scompare).
// (c) Il pulsante "Ferma" rimuove lo stato ringing.
// (d) La preferenza timerRingtone si salva nello storage e persiste al reload.

import { test, expect } from './fixtures/electron.mjs';

// Trova e restituisce la Page della newtab (dashboard).
async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('timer alla scadenza: stato ringing visibile e stop lo rimuove', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Crea un timer che scade tra 2 secondi tramite il messaggio IPC diretto.
  const msgType = await page.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await page.evaluate(async (type) => {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, label: 'Test timer', seconds: 2 }, resolve);
    });
  }, msgType);

  // Aspetta che il timer appaia nella colonna live.
  await expect(page.locator('#live .dash-live-card')).toHaveCount(1, { timeout: 4_000 });

  // Aspetta che il timer scada e passi in stato ringing (timeout 6s).
  // Il contenitore live riceve data-ringing="1" quando almeno un timer squilla.
  await expect
    .poll(
      () => page.evaluate(() => document.getElementById('live').dataset.ringing),
      { timeout: 6_000, intervals: [200] },
    )
    .toBe('1');

  // (b) Il timer è ancora visibile (card con data-ringing="1" presente).
  await expect(page.locator('#live .dash-live-card[data-ringing="1"]')).toBeVisible();

  // (c) Il pulsante "Ferma" è visibile e funzionante.
  const stopBtn = page.locator('#live .dash-live-stop');
  await expect(stopBtn).toBeVisible();

  // Strade equivalenti: il suono lo fa la shell, e il "Ferma" della scheda
  // dev'essere valido quanto il chip in cima alla finestra.
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 8_000 });
  await stopBtn.click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);

  // Dopo "Ferma" il timer è rimosso e lo stato ringing torna a "0".
  await expect
    .poll(
      () => page.evaluate(() => document.getElementById('live').dataset.ringing),
      { timeout: 4_000, intervals: [200] },
    )
    .toBe('0');

  // La card del timer non è più presente.
  await expect(page.locator('#live .dash-live-card[data-ringing="1"]')).toHaveCount(0);
});

test('preferenza timerRingtone: si salva e persiste al reload', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#timerRingtone', { timeout: 8_000 });

  // Il controllo esiste.
  await expect(page.locator('#timerRingtone')).toHaveCount(1);
  await expect(page.locator('#timerRingtonePreview')).toHaveCount(1);

  // Cambia la suoneria a "Carillon".
  await page.locator('#timerRingtone').selectOption('chime');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Persiste nello storage.
  await expect
    .poll(
      () => page.evaluate(async () => (await window.SN_STORAGE.getSettings()).timerRingtone),
      { timeout: 4_000 },
    )
    .toBe('chime');

  // Sopravvive a un reload.
  await page.reload();
  await page.waitForSelector('#timerRingtone', { timeout: 8_000 });
  await expect(page.locator('#timerRingtone')).toHaveValue('chime');
});

// Il caso del feedback #667: il timer scade mentre l'utente NON ha davanti la
// pagina Nuova scheda. Prima la suoneria viveva solo lì dentro, e senza quella
// pagina aperta la scadenza passava in silenzio.
test('il timer suona anche senza la pagina Nuova scheda aperta', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await openTab('filo://preferences/preferences.html');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });

  // Via la Nuova scheda: resta solo una pagina che di timer non sa nulla.
  await shell.evaluate(async () => {
    const stato = await new Promise((r) => { window.filoShell.tabs.onUpdate(r); });
    const nt = stato.tabs.find((t) => String(t.url || '').startsWith('filo://newtab'));
    if (nt) window.filoShell.tabs.close(nt.id);
  });
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  expect(app.windows().some((w) => w.url().startsWith('filo://newtab'))).toBe(false);

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(
    (t) => window.filoShell.message({ type: t, label: 'Uova sode', seconds: 2 }),
    tipo,
  );

  // La suoneria parte davvero: non basta il flag, l'audio dev'essere acceso.
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 10_000 });
  await expect(shell.locator('#ring-ind-label')).toHaveText('Uova sode — scaduto');
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(true);
  expect(await shell.evaluate(() => window.SN_SOUNDS.state())).toBe('running');

  // Il chip è la via per farla smettere da qualunque scheda.
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);

  // E resta zitta: la scadenza è stata consumata, non solo silenziata a video.
  await shell.waitForTimeout(1500);
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
});

// Due scadenze insieme: il chip non può dire il nome di una sola, e il gesto
// che ferma dev'essere uno solo — zittire una e lasciar suonare l'altra non è
// «ferma la suoneria».
test('due timer scaduti insieme: un solo chip, un solo gesto per fermarli', async ({ shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(async (t) => {
    await window.filoShell.message({ type: t, label: 'Pasta', seconds: 2 });
    await window.filoShell.message({ type: t, label: '', seconds: 2 });
  }, tipo);

  await expect(shell.locator('#ring-ind-label')).toHaveText('2 scadenze', { timeout: 10_000 });
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });

  // Nessuna delle due torna a suonare: erano due, e le abbiamo fermate tutte.
  await shell.waitForTimeout(1500);
  await expect(shell.locator('#ring-indicator')).toBeHidden();
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
});

// Il chip vive nella fila di tab perché la pagina non la copre mai, tranne a
// tutto schermo: lì la view prende tutta la finestra e la suoneria partiva
// senza nessun pulsante da premere (nemmeno un tasto la fermava).
test('a tutto schermo la scadenza fa rientrare la pagina, e il chip torna a portata', async ({ app, shell }) => {
  const statoFinestra = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return { pieno: w._filoTabs.contentFullscreen, y: t ? t.view.getBounds().y : null };
  });

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.setContentFullscreen(true);
  });
  expect((await statoFinestra()).pieno).toBe(true);

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(
    (t) => window.filoShell.message({ type: t, label: 'Forno', seconds: 2 }),
    tipo,
  );

  // Senza la correzione resta a tutto schermo e questo poll scade.
  await expect.poll(() => statoFinestra().then((s) => s.pieno), { timeout: 20_000 }).toBe(false);
  const dopo = await statoFinestra();
  expect(dopo.y, 'la pagina deve ripartire sotto la striscia dei tab').toBeGreaterThan(0);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 10_000 });
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
});

// Il tutto schermo può arrivare DOPO la scadenza (un video aperto mentre la
// suoneria va): la striscia col chip tornerebbe sotto la pagina e il rumore
// resterebbe senza interruttore, come prima della correzione.
test('tutto schermo a suoneria già in corso: la pagina rientra lo stesso', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const pieno = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.contentFullscreen;
  });

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Forno', seconds: 2 }), tipo);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 10_000 });

  // La scadenza è ormai annunciata: se il rientro valesse solo per quell'istante,
  // da qui in poi il tutto schermo resterebbe.
  await shell.waitForTimeout(12_000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.setContentFullscreen(true);
  });

  await expect.poll(pieno, { timeout: 20_000 }).toBe(false);
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
});

// Una finestra incognito è una finestra di Filo come le altre: ci si chiede un
// timer allo stesso modo, e i suoi timer vivono solo nella sua vista dello
// storage. Se non suonasse lei, non suonerebbe nessuno.
test('la finestra incognito fa sentire le sue scadenze, e da sola', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await shell.evaluate(() => window.filoShell.openIncognito());

  const scadenza = Date.now() + 15_000;
  let incog = null;
  while (Date.now() < scadenza && !incog) {
    incog = app.windows().find((p) => { try { return p.url().includes('incognito=1'); } catch (_) { return false; } }) || null;
    if (!incog) await new Promise((r) => setTimeout(r, 150));
  }
  expect(incog, 'la finestra incognito deve aprirsi').toBeTruthy();
  await incog.waitForLoadState('domcontentloaded').catch(() => {});

  const tipo = await incog.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await incog.evaluate((t) => window.filoShell.message({ type: t, label: 'Riso', seconds: 2 }), tipo);

  await expect(incog.locator('#ring-indicator')).toBeVisible({ timeout: 15_000 });
  expect(await incog.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(true);
  expect(await incog.evaluate(() => window.SN_SOUNDS.state())).toBe('running');

  // La finestra normale non vede quella scadenza: due finestre che suonano lo
  // stesso motivo sfasate sarebbero peggio del silenzio.
  expect(await shell.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
  await expect(shell.locator('#ring-indicator')).toBeHidden();

  await incog.locator('#ring-indicator').click();
  await expect(incog.locator('#ring-indicator')).toBeHidden({ timeout: 5_000 });
  await incog.waitForTimeout(1200);
  expect(await incog.evaluate(() => window.SN_SOUNDS.isRinging())).toBe(false);
});
