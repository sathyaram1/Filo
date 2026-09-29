// Verifica #590 — giro 12, seconda parte.
//
// Il giro 6 ha separato le due sorgenti della lista: quello che l'utente
// SCRIVE è un divieto suo (si ferma e glielo si dice), le liste pubbliche di
// pubblicità e tracciatori sono una potatura muta. Qui si guarda il punto in
// cui quella separazione torna a toccarsi, cioè l'unico caso in cui anche le
// liste pubbliche parlano: l'indirizzo che l'utente ha scritto lui.
//
// Porta BG — CHI HA MESSO QUEL DIVIETO. Un sito che l'utente non ha mai messo
//            in lista viene annunciato con le stesse identiche parole del suo
//            divieto, e nelle Preferenze non se ne trova traccia.
// Porta BH — IL PERMESSO DATO SU UN BLOCCO DELLE LISTE PUBBLICHE si deve poter
//            vedere e togliere dove l'utente va a guardare, come gli altri.
// Porta BI — LA SCATOLA DEI SITI SBLOCCATI A MANO: com'è fatta, e sparisce
//            quando l'ultimo permesso viene tolto.

import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argomentiScala } from '../../helpers/scala.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

const LISTA = 'bloccato.test';      // scritto a mano dall'utente
const PUBBLICA = 'contatore.test';  // sta SOLO nelle liste pubbliche
const NORMALE = 'giornale.test';

async function alzaServer() {
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><h1 id="t">${host}</h1>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    porta: server.address().port,
    chiudi: async () => {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

let app = null;
let shell = null;
let userData = null;
let srv = null;

const MAPPA = [LISTA, PUBBLICA, NORMALE].map((h) => `MAP ${h} 127.0.0.1`).join(', ');

test.beforeAll(async () => {
  srv = await alzaServer();
  userData = cartellaTemporanea('filo-test-590g12b-');
  mkdirSync(join(userData, 'adblock'), { recursive: true });
  // Le liste pubbliche che Filo scarica da solo, accese di serie: qui ne
  // mettiamo una voce sola, il contatore di clic.
  writeFileSync(
    join(userData, 'adblock', 'lists.json'),
    JSON.stringify({ updatedAt: Date.now(), count: 1, domains: [PUBBLICA] }),
    'utf8',
  );
  mkdirSync(SHOTS, { recursive: true });
  app = await electron.launch({
    args: [...argomentiScala, `--host-resolver-rules=${MAPPA}`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app?.close(); } catch (_) {}
  try { await srv?.chiudi(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null; srv = null;
});

async function metti(lista) {
  await shell.evaluate((h) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: true, blacklist: h } } },
  }), lista);
  await shell.waitForTimeout(400);
}

async function chiudiTutteLeSchede() {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of snap.tabs) {
    await shell.evaluate((i) => window.filoShell.tabs.close(i), t.id);
  }
  await shell.waitForTimeout(300);
}

async function pulisciNotifiche() {
  await shell.evaluate(() => document.querySelectorAll('.shell-notif').forEach((n) => n.remove()));
}

async function notifiche() {
  return shell.evaluate(() => [...document.querySelectorAll('.shell-notif')].map((n) => n.innerText));
}

function finestreSu(host) {
  return app.windows().filter((w) => {
    if (w.isClosed()) return false;
    try { return new URL(w.url()).hostname === host; } catch (_) { return false; }
  });
}

async function aspettaPagina(pezzo, ms = 10000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    for (const w of app.windows().reverse()) {
      if (w.isClosed()) continue;
      if (!String(w.url() || '').includes(pezzo)) continue;
      const viva = await w.evaluate(() => true).catch(() => false);
      if (viva) return w;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test.beforeEach(async () => {
  await chiudiTutteLeSchede();
  await pulisciNotifiche();
});

// ─── Porta BG: chi ha messo quel divieto ─────────────────────────────────────

test('BG1 — controllo: il divieto scritto dall\'utente viene annunciato col nome del sito', async () => {
  await metti([LISTA]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${LISTA}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2500);
  const dette = await notifiche();
  expect(dette.join('\n')).toContain(LISTA);
});

test('BG2 — un sito che l\'utente non ha mai messo in lista non deve essere annunciato come un suo divieto', async () => {
  await metti([]); // la lista dell'utente è VUOTA: solo le liste pubbliche
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${PUBBLICA}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2500);
  const dette = (await notifiche()).join('\n');
  // La notifica c'è, ed è giusto che ci sia: l'utente ha chiesto quell'indirizzo
  // e una richiesta che finisce nel nulla senza una parola sembra un guasto.
  expect(dette, 'una richiesta esplicita fermata deve essere detta').toContain(PUBBLICA);
  // Ma deve distinguersi dal divieto che l'utente ha scritto lui: qui la regola
  // arriva dalle liste di pubblicità e tracciatori che Filo aggiorna da solo, e
  // l'unico interruttore che la spegne sta in Preferenze sotto un altro nome.
  expect(
    dette.toLowerCase(),
    'la notifica usa le stesse identiche parole del divieto scritto dall\'utente («Sito '
    + 'bloccato: <nome>»), e quel sito nelle Preferenze non compare da nessuna parte: chi va a '
    + 'cercarlo nella propria lista non lo trova, e non ha modo di sapere che a fermarlo sono '
    + 'state le liste pubbliche né dove si spengono. '
    + `Notifica: ${JSON.stringify(dette)}`,
  ).toMatch(/lista|pubblic|pubblicit|tracciator/);
});

// ─── Porta BH: il permesso dato su un blocco delle liste pubbliche ───────────

test('BH — il sì dato su un blocco delle liste pubbliche si deve vedere e togliere in Preferenze', async () => {
  await metti([]);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://${PUBBLICA}:${srv.porta}/pagina`);
  await shell.waitForTimeout(2500);
  const avviso = shell.locator('.shell-notif', { hasText: 'Apri comunque' }).first();
  await avviso.waitFor({ state: 'visible', timeout: 8000 });
  await avviso.getByText('Apri comunque', { exact: true }).first().click();
  await shell.waitForTimeout(2500);

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const pref = await aspettaPagina('security.html');
  expect(pref, 'la pagina Sicurezza deve aprirsi').toBeTruthy();
  await pref.waitForTimeout(1200);
  const testo = await pref.evaluate(() => {
    const box = document.getElementById('sec-siteblock-allowed-box');
    if (!box || box.style.display === 'none') return '';
    return box.innerText;
  });
  expect(
    testo,
    'un permesso che dura tutta la sessione si deve poter vedere e togliere dove l\'utente la '
    + 'lista l\'ha scritta, qualunque delle due liste l\'abbia fatto scattare',
  ).toContain(PUBBLICA);
});

// ─── Porta BI: la scatola dei siti sbloccati a mano ──────────────────────────

test('BI — la scatola dei siti sbloccati sta dentro la pagina e sparisce quando si svuota', async () => {
  await metti([LISTA]);
  // Un sì su un nome cortissimo e uno su un nome lunghissimo, per vedere come
  // la riga regge un indirizzo che non ci sta.
  await shell.evaluate(() => window.filoShell.tabs.openSiteAnyway(
    'http://bloccato.test/pagina',
  ));
  await shell.waitForTimeout(1200);
  await shell.evaluate(() => window.filoShell.tabs.openSiteAnyway(
    'http://un-nome-di-sito-davvero-lunghissimo-che-non-sta-in-una-riga.esempio.test/x',
  ));
  await shell.waitForTimeout(1500);

  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  const pref = await aspettaPagina('security.html');
  expect(pref, 'la pagina Sicurezza deve aprirsi').toBeTruthy();
  await pref.waitForTimeout(1200);
  await pref.evaluate(() => {
    const box = document.getElementById('sec-siteblock-allowed-box');
    if (box) box.scrollIntoView({ block: 'center' });
  });
  await pref.screenshot({ path: join(SHOTS, '590-giro12-siti-sbloccati.png') });

  // Niente deve uscire dalla larghezza della pagina.
  const sborda = await pref.evaluate(() => {
    const box = document.getElementById('sec-siteblock-allowed-box');
    if (!box) return 'nessuna scatola';
    const r = box.getBoundingClientRect();
    return (r.right > document.documentElement.clientWidth + 1) ? `esce di ${Math.round(r.right - document.documentElement.clientWidth)}px` : '';
  });
  expect(sborda, 'la scatola dei siti sbloccati non deve uscire dalla pagina').toBe('');

  // Tolti tutti i permessi, la scatola sparisce (se si può concedere si deve
  // poter togliere, e quando non c'è niente non si mostra una scatola vuota).
  const bottoni = pref.locator('#sec-siteblock-allowed-list button');
  const quanti = await bottoni.count();
  expect(quanti, 'un bottone per ogni permesso').toBe(2);
  for (let i = 0; i < quanti; i += 1) {
    await pref.locator('#sec-siteblock-allowed-list button').first().click();
    await pref.waitForTimeout(600);
  }
  const visibile = await pref.evaluate(() => {
    const box = document.getElementById('sec-siteblock-allowed-box');
    return !!box && box.style.display !== 'none';
  });
  expect(visibile, 'tolto l\'ultimo permesso la scatola deve sparire').toBe(false);
});
