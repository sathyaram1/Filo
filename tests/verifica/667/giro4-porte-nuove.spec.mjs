// Verifica #667 — «il timer non suona», giro 4.
//
// I giri prima hanno chiuso: la scadenza fuori dalla Nuova scheda, quella
// incognito, il tutto schermo nei due versi, la suoneria sovrapposta a sé
// stessa e le due finestre incognito. Qui si contano le porte rimaste verso
// lo stesso danno, cioè una scadenza che resta viva e muta: la pagina i cui
// risvegli il sistema strozza, la finestra che suonava e si chiude, la
// sveglia che si ripete, il timer messo in pausa e la finestra che quella
// scadenza non può vederla.

import { test, expect } from '../../fixtures/electron.mjs';

const suona = (p) => p.evaluate(() => (window.SN_SOUNDS ? window.SN_SOUNDS.isRinging() : null));
const audio = (p) => p.evaluate(() => (window.SN_SOUNDS ? window.SN_SOUNDS.state() : null));

const metti = (shell, label, seconds) => shell.evaluate(
  ({ l, s }) => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: l, seconds: s }),
  { l: label, s: seconds },
);

const timers = (shell) => shell.evaluate(
  () => window.filoShell.message({ type: window.SN_MSG.MSG.FILO_GET_TIMERS }),
);

async function attendi(fn, ms = 20_000) {
  const scadenza = Date.now() + ms;
  while (Date.now() < scadenza) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// Porta 1: la finestra tolta di mezzo. Filo promette all'utente che anche
// ridotto a icona suoneria e notifica arrivano: è il caso di chi mette il
// timer della pasta e torna a lavorare in un'altra applicazione. Lì il sistema
// rallenta i risvegli della pagina a uno al minuto, quindi la suoneria regge
// solo se è già programmata avanti sulla linea del tempo dell'audio. Un
// contenitore senza gestore di finestre non sa nascondere davvero la finestra:
// qui si misura la cosa che conta, cioè quanto avanti arriva il suono già
// programmato, e poi si sopprimono i risvegli per vedere se continua.
test('la suoneria è programmata avanti, e regge senza risvegli della pagina', async ({ shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Registra ogni nota programmata e fin dove arriva sulla linea del tempo.
  await shell.evaluate(() => {
    window.__note = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    const creaOrig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const o = creaOrig.call(this);
      const nota = { ctx: this, fine: 0 };
      window.__note.push(nota);
      const stopOrig = o.stop.bind(o);
      o.stop = (t) => { nota.fine = Number(t) || 0; return stopOrig(t); };
      return o;
    };
  });

  await metti(shell, 'Pasta', 3);
  const sentito = await attendi(() => suona(shell), 20_000);
  expect(sentito, 'la scadenza deve suonare').toBe(true);
  expect(await audio(shell), "l'audio della finestra dev'essere acceso davvero").toBe('running');

  const orizzonte = () => shell.evaluate(() => {
    const n = window.__note.filter((x) => x.fine > 0);
    if (!n.length) return null;
    const c = n[0].ctx;
    return Math.max(...n.map((x) => x.fine)) - c.currentTime;
  });

  const primo = await attendi(async () => {
    const v = await orizzonte();
    return v && v > 0 ? v : null;
  }, 10_000);
  expect(primo, 'il suono dev’essere già programmato avanti, non nota per nota')
    .toBeGreaterThan(30);

  // Da qui nessun risveglio della pagina parte più: il caso peggiore della
  // finestra fuori dagli occhi, dove il rifornimento arriva tardi o mai.
  await shell.evaluate(() => { window.setTimeout = () => 0; });
  await shell.waitForTimeout(20_000);
  const dopo = await orizzonte();
  expect(dopo, 'venti secondi senza risvegli e il suono deve avere ancora coda')
    .toBeGreaterThan(5);

  // E il gesto per fermare funziona lo stesso.
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shell.waitForTimeout(1200);
  expect(await suona(shell)).toBe(false);
});

// Porta 2: la finestra che suonava se ne va. Fra le finestre che vedono la
// stessa scadenza ne suona una sola: se chi suonava si chiude senza passare il
// turno, il rumore muore con lei e la scadenza resta viva e muta.
test('chiusa la finestra che suonava, il turno passa a quella rimasta', async ({ app, shell }) => {
  test.setTimeout(180_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const incognite = () => app.windows().filter((w) => {
    try { return w.url().includes('incognito=1'); } catch (_) { return false; }
  });

  await shell.evaluate(() => window.filoShell.openIncognito());
  await attendi(async () => incognite().length >= 1);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const due = await attendi(() => (incognite().length >= 2 ? incognite() : null));
  expect(due, 'due finestre incognito devono potersi aprire').toBeTruthy();
  for (const p of due) await p.waitForLoadState('domcontentloaded').catch(() => {});

  await metti(due[0], 'Riso', 3);
  const sentito = await attendi(async () => (await suona(due[0])) || (await suona(due[1])));
  expect(sentito, 'la scadenza incognito deve farsi sentire').toBe(true);

  const chiSuonava = (await suona(due[0])) ? 0 : 1;
  const resta = due[1 - chiSuonava];
  await due[chiSuonava].evaluate(() => window.close());
  await attendi(() => incognite().length === 1, 15_000);

  const ripreso = await attendi(() => suona(resta), 20_000);
  expect(ripreso, 'la finestra rimasta deve raccogliere la suoneria della scadenza ancora viva').toBe(true);
  await expect(resta.locator('#ring-indicator')).toBeVisible({ timeout: 10_000 });
  await resta.locator('#ring-indicator').click();
  await expect(resta.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 3: la sveglia che si ripete. Filo la promette all'utente ("il lunedì
// e il mercoledì") e fermarla stamattina non deve disdire quella di mercoledì:
// se «Ferma» la cancellasse, la sveglia dopo non suonerebbe mai.
test('una sveglia ricorrente suona, e fermarla lascia in piedi la prossima', async ({ app, shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  // Messa all'orario del minuto in corso, facendo credere ad addAlarm che sia
  // l'inizio di quel minuto: l'occorrenza di oggi cade quindi pochi secondi nel
  // passato e scade subito, senza aspettare il giro dell'orologio.
  const messa = await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const ora = new Date();
    const hh = String(ora.getHours()).padStart(2, '0');
    const mm = String(ora.getMinutes()).padStart(2, '0');
    const inizioMinuto = Math.floor(Date.now() / 60000) * 60000;
    return M.addAlarm({
      label: 'Palestra', time: `${hh}:${mm}`, repeat: 'tutti i giorni', nowMs: inizioMinuto - 1000,
    });
  });
  expect(messa, 'la sveglia ricorrente deve nascere').toBeTruthy();
  expect(messa.repeat, 'e deve essere davvero ricorrente').toBeTruthy();
  expect(new Date(messa.endsAt).getTime(), "puntata sull'occorrenza di oggi, già passata")
    .toBeLessThanOrEqual(Date.now());

  const sentito = await attendi(() => suona(shell), 25_000);
  expect(sentito, 'una sveglia ricorrente scaduta deve suonare come le altre').toBe(true);
  await expect(shell.locator('#ring-ind-label')).toHaveText('Sveglia — Palestra', { timeout: 10_000 });

  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shell.waitForTimeout(1500);
  expect(await suona(shell)).toBe(false);

  const dopo = await timers(shell);
  const viva = (dopo.timers || []).find((t) => t.id === messa.id);
  expect(viva, 'fermata stamattina, la sveglia ricorrente deve restare in lista').toBeTruthy();
  expect(viva.ringing, 'e deve essere muta').toBeFalsy();
  expect(new Date(viva.endsAt).getTime(), 'puntata su unoccorrenza futura')
    .toBeGreaterThan(Date.now());
});

// Porta 4: il timer messo in pausa e ripreso. È una strada che Filo promette
// («⏸ per metterlo in pausa e ▶ per riprenderlo»): se dopo la ripresa la
// scadenza non suonasse più, sarebbe la lamentela di partenza per chi usa
// quella coppia di pulsanti.
test('un timer messo in pausa e ripreso suona alla nuova scadenza', async ({ shell }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const r = await metti(shell, 'Uova', 6);
  const id = r && r.timer && r.timer.id;
  expect(id, 'il timer deve nascere').toBeTruthy();

  const msg = (type) => shell.evaluate(
    ({ t, i }) => window.filoShell.message({ type: window.SN_MSG.MSG[t], id: i }),
    { t: type, i: id },
  );
  await msg('FILO_PAUSE_TIMER');
  // In pausa la scadenza non arriva: passato il tempo originale, silenzio.
  await shell.waitForTimeout(8000);
  expect(await suona(shell), 'in pausa un timer non deve suonare').toBe(false);
  await expect(shell.locator('#ring-indicator')).toBeHidden();

  await msg('FILO_RESUME_TIMER');
  const sentito = await attendi(() => suona(shell), 25_000);
  expect(sentito, 'ripreso, il timer deve suonare alla nuova scadenza').toBe(true);
  await expect(shell.locator('#ring-ind-label')).toHaveText('Uova — scaduto', { timeout: 10_000 });
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
});

// Porta 5: resta aperta solo una finestra incognito. Chiudere la finestra
// normale non spegne Filo finché ne resta un'altra, e una finestra incognito
// vede soltanto le proprie scadenze: quella della pasta, messa prima, scadeva
// senza che nessuno la facesse sentire e senza lasciare niente da premere.
// È la lamentela di partenza presa dalla porta della finestra che non può
// vedere quella scadenza.
test('chiusa la finestra normale, la scadenza normale si fa sentire lo stesso', async ({ app, shell }) => {
  test.setTimeout(180_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });

  const incognite = () => app.windows().filter((w) => {
    try { return w.url().includes('incognito=1'); } catch (_) { return false; }
  });

  await metti(shell, 'Pasta', 12);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const incog = await attendi(() => (incognite().length ? incognite()[0] : null));
  expect(incog, 'la finestra incognito deve aprirsi').toBeTruthy();
  await incog.waitForLoadState('domcontentloaded').catch(() => {});

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.close();
  });
  await incog.waitForTimeout(1000);
  const vive = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  expect(vive, 'Filo deve restare in piedi con la sola finestra incognito').toBeGreaterThan(0);

  // La scadenza arriva adesso: qualcuno deve farla sentire, e deve restare
  // raggiungibile un gesto per fermarla. Dove non conta: conta che ci sia.
  const shellDiTurno = await attendi(async () => {
    for (const p of app.windows()) {
      try {
        if (!/shell\.html/.test(p.url())) continue;
        if (await p.evaluate(() => !!(window.SN_SOUNDS && window.SN_SOUNDS.isRinging()))) return p;
      } catch (_) { /* finestra in chiusura o non ancora pronta */ }
    }
    return null;
  }, 40_000);
  expect(shellDiTurno, 'la scadenza deve suonare da qualche finestra').toBeTruthy();
  expect(await audio(shellDiTurno), "e l'audio dev'essere acceso davvero").toBe('running');

  await expect(shellDiTurno.locator('#ring-indicator')).toBeVisible({ timeout: 10_000 });
  await shellDiTurno.locator('#ring-indicator').click();
  await expect(shellDiTurno.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shellDiTurno.waitForTimeout(1200);
  expect(await suona(shellDiTurno)).toBe(false);
});
