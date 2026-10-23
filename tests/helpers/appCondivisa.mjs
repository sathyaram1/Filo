// Un solo Filo per un file di spec intero: lanciato come lo lancia la fixture, dato alle prove come `app` (con `shell`,
// `openTab`, `testServer` della fixture, che non si tocca) e riportato com'era appena aperto prima di ogni prova.
// Cosa si azzera e cosa no: patterns/una-suite-accorpata-riparte-pulita-a-ogni-prova.md; sentinella: appCondivisa.test.mjs.

import { _electron as electron } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, chiudiApp, argomentiScala } from '../fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './percorsi.mjs';
import { primaFinestra } from './primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const OPZIONI_FIXTURE = Object.freeze({ accoglienzaFatta: true, riservaNuovaScheda: false, stratoDelMenu: false, argomentiInPiu: [], hostInPiu: [], inPausaAperte: true });
// Le stesse della fixture, nello stesso ordine: la sentinella le confronta col suo sorgente.
export const REGOLE_HOST = Object.freeze(['MAP blocked.test 127.0.0.1', 'MAP 192.168.1.1 127.0.0.1:9', 'MAP sito-pubblico.test 127.0.0.1']);

/** Argomenti e ambiente del lancio, gli stessi della fixture `app`. PURA. */
export function lancio(userData, { accoglienzaFatta, riservaNuovaScheda, stratoDelMenu, argomentiInPiu, hostInPiu, inPausaAperte } = OPZIONI_FIXTURE, env = process.env) {
  const regole = [...REGOLE_HOST, ...hostInPiu.map((h) => `MAP ${h} 127.0.0.1`)].join(', ');
  return {
    args: [...argomentiScala, ...argomentiInPiu, `--host-resolver-rules=${regole}`, '.'],
    cwd: APP_ROOT,
    env: {
      ...env,
      FILO_USER_DATA: userData,
      FILO_TEST_ACCOLTO: accoglienzaFatta ? '1' : '0',
      ...(riservaNuovaScheda ? { FILO_RISERVA_NUOVA_SCHEDA: '1' } : {}),
      FILO_STRATO_MENU: stratoDelMenu ? '1' : '0',
      FILO_TEST_IN_PAUSA_APERTE: inPausaAperte ? '1' : '0',
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  };
}

// Senza l'uscita dell'app un rosso che c'è solo in GitHub non si spiega (#639); qui una riga segna dove parte ogni prova.
const TETTO_RIGHE_APP = 20_000;
function registraUscite(app) {
  const righe = [];
  const t0 = Date.now();
  const resti = { out: '', err: '' };
  const metti = (r) => { righe.push(`+${Date.now() - t0}ms ${r}`); if (righe.length > TETTO_RIGHE_APP) righe.shift(); };
  const prendi = (canale) => (pezzo) => {
    const parti = (resti[canale] + pezzo.toString('utf8')).split('\n');
    resti[canale] = parti.pop();
    for (const r of parti) metti(`[${canale}] ${r}`);
  };
  try {
    const proc = app.process();
    proc.stdout?.on('data', prendi('out'));
    proc.stderr?.on('data', prendi('err'));
  } catch (_) {}
  return {
    segna: (titolo) => metti(`===== prova: ${titolo}`),
    testo: () => [`Uscita dell'app condivisa dal lancio (al più ${TETTO_RIGHE_APP} righe):`, ...righe].join('\n'),
  };
}

// Nel main: la foto di ciò che una prova può rattoppare (funzioni globali e metodi degli oggetti SN_/__filo) e dello
// storage, presa a lancio fermo. Gira dentro app.evaluate: niente chiusure su variabili di qui.
async function fotografaNelMain() {
  const funzioni = (o) => {
    const m = new Map();
    for (const k of Object.getOwnPropertyNames(o)) {
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (d && 'value' in d && d.writable && typeof d.value === 'function') m.set(k, d.value);
    }
    return m;
  };
  const globali = new Map();
  const oggetti = new Map();
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    const d = Object.getOwnPropertyDescriptor(globalThis, k);
    if (!d || !('value' in d)) continue;
    globali.set(k, d.value);
    if (/^(SN_|__filo)/.test(k) && d.value && typeof d.value === 'object') oggetti.set(k, { obj: d.value, fn: funzioni(d.value) });
  }
  await globalThis.__filoStorage.whenSettled();
  const storage = JSON.stringify(await globalThis.chrome.storage.local.get(null));
  // Il filo ha un file suo (chat, cambi, schede…): torna anche lui com'era.
  await globalThis.SN_REGISTRO_CAMBI?.attesa?.();
  const filo = (await globalThis.SN_IL_FILO.esporta()).toString('utf8');
  globalThis.__filoAppCondivisa = { globali, oggetti, storage, filo };
}

// Nel main: rimette le funzioni rattoppate e toglie i globali `__x` delle prove (l'app ne crea solo coi nomi __filo*).
function ripristinaNelMain() {
  const s = globalThis.__filoAppCondivisa;
  const rimessi = [];
  for (const k of Object.getOwnPropertyNames(globalThis)) {
    if (!s.globali.has(k) && /^__(?!filo)/.test(k)) { delete globalThis[k]; rimessi.push(`-${k}`); }
  }
  for (const [k, v] of s.globali) {
    if (typeof v === 'function' && globalThis[k] !== v) { globalThis[k] = v; rimessi.push(k); }
  }
  for (const [k, { obj, fn }] of s.oggetti) {
    for (const [p, f] of fn) if (obj[p] !== f) { obj[p] = f; rimessi.push(`${k}.${p}`); }
  }
  return rimessi;
}

// Nel main: chiude ogni scheda (la finestra resta con una home nuova) e le finestre in più, e aspetta che le pagine
// chiuse se ne siano andate davvero: una casella in sospeso spedisce prima di chiudersi (chiusuraConCaselle).
async function chiudiSchedeNelMain({ BrowserWindow }, tetto) {
  const finestre = BrowserWindow.getAllWindows().filter((w) => w._filoTabs).sort((a, b) => a.id - b.id);
  const principale = finestre[0];
  for (const w of finestre.slice(1)) { try { w.close(); } catch (_) {} }
  const t = principale._filoTabs;
  if (t.barra?.aperta) t.barra.chiudi();
  if (principale.isFullScreen()) principale.setFullScreen(false);
  const vecchie = t.tabs.map((x) => x.view?.webContents).filter(Boolean);
  t.closeAllTabs();
  const fine = Date.now() + tetto;
  while (Date.now() < fine && (vecchie.some((wc) => !wc.isDestroyed()) || BrowserWindow.getAllWindows().filter((w) => w._filoTabs).length > 1)) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return vecchie.filter((wc) => !wc.isDestroyed()).map((wc) => wc.getURL());
}

// Nel main: lo storage e il filo com'erano a lancio fermo (archivi, cronologia e segnalazioni compresi), e le impostazioni
// rimesse ai servizi che le tengono in memoria. Fuori dal registro dei cambi, come una migrazione.
async function azzeraStorageNelMain() {
  const s = globalThis.__filoAppCondivisa;
  await globalThis.__filoStorage.whenSettled();
  await globalThis.SN_REGISTRO_CAMBI.attesa();
  await globalThis.SN_IL_FILO?.quandoFermo?.();
  await globalThis.SN_IL_FILO.ricomincia(s.filo);
  await globalThis.SN_REGISTRO_CAMBI.con({ via: 'migrazione' }, async () => {
    await globalThis.chrome.storage.local.clear();
    await globalThis.chrome.storage.local.set(JSON.parse(s.storage));
    await globalThis.__filoHandlers.applySettingsUpdate({});
  });
  await globalThis.__filoStorage.whenSettled();
}

/**
 * Registra sul file chiamante il lancio unico (beforeAll), la chiusura (afterAll) e l'azzeramento prima di ogni prova
 * dopo la prima; torna `test` ed `expect` da usare al posto di quelli della fixture, e `azzera` per chi lo vuole a metà.
 */
export function appCondivisa(opzioni = {}) {
  const avvio = { ...OPZIONI_FIXTURE, ...opzioni };
  const stato = { app: null, userData: null, uscite: null, pulita: false, initScript: [] };

  const test = base.extend({
    app: async ({ accoglienzaFatta, riservaNuovaScheda, stratoDelMenu, argomentiInPiu, hostInPiu }, use) => {
      const chiesto = JSON.stringify({ accoglienzaFatta, riservaNuovaScheda, stratoDelMenu, argomentiInPiu, hostInPiu });
      const lanciato = JSON.stringify({ accoglienzaFatta: avvio.accoglienzaFatta, riservaNuovaScheda: avvio.riservaNuovaScheda, stratoDelMenu: avvio.stratoDelMenu, argomentiInPiu: avvio.argomentiInPiu, hostInPiu: avvio.hostInPiu });
      if (chiesto !== lanciato) {
        throw new Error(`appCondivisa: la prova chiede un avvio ${chiesto}, l'app del file è lanciata con ${lanciato}. Passa le opzioni ad appCondivisa() o lasciala in un file suo.`);
      }
      await use(stato.app);
    },
  });

  test.beforeAll(async () => {
    stato.userData = cartellaTemporanea('filo-test-');
    stato.app = await electron.launch(lancio(stato.userData, avvio));
    stato.uscite = registraUscite(stato.app);
    // Gli script iniettati da una prova restano sul contesto: si tengono da parte per toglierli alla prova dopo.
    const ctx = stato.app.context();
    const aggiungi = ctx.addInitScript.bind(ctx);
    ctx.addInitScript = async (...a) => { const d = await aggiungi(...a); stato.initScript.push(d); return d; };
    await primaFinestra(stato.app);
    await aspettaHome(stato.app);
    await stato.app.evaluate(fotografaNelMain);
    stato.pulita = true;
  });

  test.afterAll(async () => {
    if (stato.app) await chiudiApp(stato.app);
    if (stato.userData) togliCartella(stato.userData);
    stato.app = null;
  });

  test.beforeEach(async ({}, testInfo) => {
    stato.uscite?.segna(testInfo.titlePath.slice(1).join(' › '));
    if (!stato.pulita) await riportaComeAppenaAperta(stato);
    stato.pulita = false;
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus || !stato.uscite) return;
    try {
      const file = testInfo.outputPath('uscita-app.txt');
      writeFileSync(file, stato.uscite.testo());
      await testInfo.attach('uscita-app', { path: file, contentType: 'text/plain' });
    } catch (_) {}
  });

  return { test, expect, azzera: () => riportaComeAppenaAperta(stato) };
}

// Dopo l'azzeramento basta che la home ci sia, come dopo un lancio: chi la usa ne aspetta il caricamento da sé.
async function aspettaHome(app, { caricata = true } = {}) {
  let home = null;
  await expect.poll(() => Boolean(home = app.windows().find((w) => { try { return !w.isClosed() && w.url().startsWith('filo://newtab'); } catch (_) { return false; } })),
    { message: 'appCondivisa: la home non è arrivata', timeout: 0, intervals: [50] }).toBe(true);
  if (caricata) await home.waitForLoadState('domcontentloaded').catch(() => {});
  return home;
}

async function chiudiSchede(app) {
  const restate = await app.evaluate(chiudiSchedeNelMain, 6_000);
  if (restate.length) throw new Error(`appCondivisa: schede che non si chiudono, la prova dopo le troverebbe: ${restate.join(', ')}`);
}

async function riportaComeAppenaAperta(stato) {
  const { app } = stato;
  for (const d of stato.initScript.splice(0)) await d.dispose().catch(() => {});
  await app.context().unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  const rimessi = await app.evaluate(ripristinaNelMain);
  if (process.env.FILO_APP_CONDIVISA_DEBUG === '1' && rimessi.length) console.log(`[appCondivisa] rimessi: ${rimessi.join(', ')}`);
  await chiudiSchede(app);
  await app.evaluate(azzeraStorageNelMain);
  // La home aperta dalla prima chiusura è nata con lo storage della prova: se ne apre una nata dopo l'azzeramento.
  await chiudiSchede(app);
  await aspettaHome(app, { caricata: false });
  const shell = await primaFinestra(app);
  // La X ferma i tempi dell'avviso; la card si toglie subito, senza aspettare la transizione.
  await shell.evaluate(() => {
    for (const c of document.querySelectorAll('#shell-notifs > .shell-notif')) {
      c.querySelector('.shell-notif-close')?.click();
      c.remove();
    }
  });
}
