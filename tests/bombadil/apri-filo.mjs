// Apre Filo con il debugger remoto acceso e ci lascia dentro una pagina interna,
// perché Bombadil (che gira in WSL) possa agganciarsi da fuori.
//
// Perché non la fixture Playwright: `_electron.launch` si prende già il debugger
// remoto su una porta casuale (`--remote-debugging-port=0`, vedi il loader di
// playwright-core) e quella porta non la dice a nessuno. Qui Electron si avvia a
// mano su una porta FISSA, e Playwright ci si riattacca da cliente come farebbe
// qualunque altro (`connectOverCDP`): due clienti CDP sullo stesso Chromium
// convivono, e il secondo è Bombadil.
//
// Uso:
//   node tests/bombadil/apri-filo.mjs [url-interna] [porta]
// Resta in piedi finché non lo fermi (Ctrl+C), poi ripulisce la cartella dati.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { argomentiScala } from '../helpers/scala.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..', '..');

const URL_INTERNA = process.argv[2] || 'filo://preferences/preferences.html';
const PORTA = Number(process.argv[3] || 9222);

const userData = cartellaTemporanea('filo-bombadil-');
const eseguibile = resolve(APP_ROOT, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');

const figlio = spawn(eseguibile, [
  ...argomentiScala,
  `--remote-debugging-port=${PORTA}`,
  // Il debugger di Chromium rifiuta le connessioni WebSocket con un Origin che
  // non conosce: da WSL l'indirizzo non è mai quello che si aspetta.
  '--remote-allow-origins=*',
  '.',
], {
  cwd: APP_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    FILO_USER_DATA: userData,
    FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
    NODE_ENV: 'test',
  },
});

let chiuso = false;
function ripulisci() {
  if (chiuso) return;
  chiuso = true;
  try { figlio.kill(); } catch (_) {}
  setTimeout(() => {
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
    process.exit(0);
  }, 500);
}
process.on('SIGINT', ripulisci);
process.on('SIGTERM', ripulisci);
figlio.on('exit', ripulisci);

async function attendi(fn, timeout = 30_000) {
  const scadenza = Date.now() + timeout;
  let ultimo;
  while (Date.now() < scadenza) {
    try {
      const r = await fn();
      if (r) return r;
    } catch (e) { ultimo = e; }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw ultimo || new Error('timeout');
}

const browser = await attendi(() => chromium.connectOverCDP(`http://127.0.0.1:${PORTA}`));
const contesto = browser.contexts()[0];

// La shell è l'unica pagina che espone filoShell: le schede sono WebContentsView
// separati e non ce l'hanno.
const shell = await attendi(async () => {
  for (const p of contesto.pages()) {
    const ok = await p.evaluate(() => !!window.filoShell?.tabs?.open).catch(() => false);
    if (ok) return p;
  }
  return null;
});

await shell.evaluate((u) => window.filoShell.tabs.open(u), URL_INTERNA);

const atteso = new URL(URL_INTERNA).hostname;
const scheda = await attendi(() => contesto.pages().find((p) => {
  try { return new URL(p.url()).hostname === atteso; } catch (_) { return false; }
}) || null);

// Bombadil, quando si aggancia a un debugger che non ha aperto lui, prende la
// PRIMA pagina che il debugger elenca (`find_page` in bombadil-browser) e avvisa
// soltanto che ce n'erano altre. Quindi qui restano in piedi due sole pagine: la
// shell (che È la finestra, non si può chiudere) e quella da provare. L'ordine
// si controlla prima di dichiarare pronto: se in testa c'è la shell, Bombadil
// andrebbe a fuzzare la barra delle schede credendo di provare la pagina.
const istantanea = await shell.evaluate(() => window.filoShell.tabs.snapshot());
const schede = istantanea?.tabs || istantanea || [];
for (const t of schede) {
  const u = String(t.url || '');
  if (u === URL_INTERNA || u.startsWith(URL_INTERNA)) continue;
  await shell.evaluate((id) => window.filoShell.tabs.close(id), t.id).catch(() => {});
}

const sessione = await browser.newBrowserCDPSession();
const pagine = await attendi(async () => {
  const r = await sessione.send('Target.getTargets', { filter: [{ type: 'page' }] });
  const lista = r.targetInfos.filter((t) => t.url !== 'filo://shell/shell.html');
  return lista.length === 1 ? r.targetInfos : null;
}, 10_000).catch(() => null);

const prima = pagine?.[0]?.url;
if (prima !== undefined && prima !== URL_INTERNA) {
  console.warn(`\n[apri-filo] ATTENZIONE: la prima pagina per il debugger è ${prima},`
    + ` non ${URL_INTERNA}. Bombadil proverebbe quella.`);
}

console.log(`\n[apri-filo] scheda pronta: ${scheda.url()}`);
console.log(`[apri-filo] debugger: http://127.0.0.1:${PORTA}`);
console.log('[apri-filo] in piedi. Ctrl+C per chiudere.\n');
