// Verifica #667 — giro 2: le porte che restano per «il timer non suona».
//
// Il giro 1 ha chiuso la porta della pagina a tutto schermo alla scadenza. Qui
// si contano le altre strade che portano allo stesso stato: una scadenza che
// non si sente, o un rumore senza interruttore raggiungibile.

import { test, expect } from '../../fixtures/electron.mjs';

const suona = (p) => p.evaluate(() => (window.SN_SOUNDS ? window.SN_SOUNDS.isRinging() : null));

async function attendi(fn, ms = 15_000) {
  const scadenza = Date.now() + ms;
  while (Date.now() < scadenza) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Porta 1: la finestra incognito. È una finestra di Filo come le altre — ci si
// chiede un timer allo stesso modo — e la scadenza deve farsi sentire lo stesso.
test('un timer messo da una finestra incognito si fa sentire', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await shell.evaluate(() => window.filoShell.openIncognito());

  const incog = await attendi(() => {
    const p = app.windows().find((w) => { try { return w.url().includes('incognito=1'); } catch (_) { return false; } });
    return p || null;
  });
  expect(incog, 'la finestra incognito deve aprirsi').toBeTruthy();
  await incog.waitForLoadState('domcontentloaded').catch(() => {});

  const tipo = await incog.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  const creato = await incog.evaluate(
    (t) => window.filoShell.message({ type: t, label: 'Riso', seconds: 2 }),
    tipo,
  );
  expect(creato.ok, 'il timer chiesto da incognito viene creato').toBe(true);

  // La scadenza arriva davvero: senza questo, un silenzio direbbe solo che il
  // timer non è mai stato messo.
  const scaduto = await attendi(async () => {
    const r = await incog.evaluate((t) => window.filoShell.message({ type: t }), await incog.evaluate(() => window.SN_MSG.MSG.FILO_GET_TIMERS));
    return (r.timers || []).some((x) => x.ringing);
  });
  expect(scaduto, 'la scadenza viene marcata come in corso').toBe(true);

  const sentito = await attendi(async () => (await suona(incog)) || (await suona(shell)));
  expect(sentito, 'qualcuno in Filo deve far sentire la scadenza').toBe(true);
});

// Porta 2: il tutto schermo che arriva DOPO, a suoneria già partita. La striscia
// coi comandi finisce sotto la pagina e il rumore resta senza interruttore: è la
// stessa porta chiusa nel giro 1, presa dall'altro verso.
test('tutto schermo mentre suona: il gesto per fermare resta raggiungibile', async ({ app, shell, testServer, openTab }) => {
  test.setTimeout(120_000);
  const pieno = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.contentFullscreen;
  });

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await testServer.openReady(openTab, '<html><body><h1>video</h1></body></html>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Forno', seconds: 2 }), tipo);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  expect(await suona(shell)).toBe(true);

  // Il tutto schermo arriva a scadenza ormai ANNUNCIATA: senza questa attesa il
  // giro del main capita dopo, la porta si chiude per caso e la prova mente.
  await shell.waitForTimeout(12_000);

  // Adesso la pagina va a tutto schermo: il rumore c'è già.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.setContentFullscreen(true);
  });
  expect(await pieno()).toBe(true);

  await expect.poll(pieno, { timeout: 20_000 }).toBe(false);
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 3: fermare CHIEDENDO a Filo. È la strada di sempre («tutto si può fare
// scrivendo cosa si vuole»): se il timer si mette dalla chat, dalla chat si deve
// poter far smettere.
test('«cancella il timer» dalla chat zittisce la suoneria', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Riso', seconds: 2 }), tipo);
  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });

  const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'CANCELLA_SVEGLIA', label: 'Riso' });
  expect(r.executed).toBe(true);

  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shell.waitForTimeout(1200);
  expect(await suona(shell)).toBe(false);
});
