// La metà della mappa prova → file che sta nelle pagine (#2502): ogni Electron aperto da una prova porta il nome della
// prova al suo processo main (src/main/copertura.js) e qui si registrano le funzioni di src/ eseguite dalle sue pagine.
// Acceso solo da FILO_COPERTURA (playwright.config.js); il formato lo legge scripts/lib/mappaProve.mjs.

import { _electron, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OGNI_MS = 1000;

/** Il nome della prova in corsa, relativo al repo e a barre normali; vuoto fuori da una prova. */
function provaInCorsa() {
  try { return relative(ROOT, test.info().file).split('\\').join('/'); } catch (_) { return ''; }
}

function segui(app, prova, dir) {
  const viste = new Map();
  const sessioni = new Set();
  const accumula = (res) => {
    for (const s of res?.result || []) {
      if (!s.url) continue;
      let set = viste.get(s.url);
      if (!set) viste.set(s.url, (set = new Set()));
      for (const f of s.functions || []) {
        const r = f.ranges && f.ranges[0];
        if (r && r.count > 0) set.add(`${r.startOffset}:${r.endOffset}`);
      }
    }
  };
  const prendi = () => Promise.all([...sessioni].map((s) => s.send('Profiler.takePreciseCoverage').then(accumula, () => sessioni.delete(s))));
  const aggancia = async (page) => {
    try {
      const s = await app.context().newCDPSession(page);
      await s.send('Profiler.enable');
      await s.send('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
      sessioni.add(s);
      page.once('close', () => sessioni.delete(s));
    } catch (_) {}
  };
  let contesto = null;
  try { contesto = app.context(); } catch (_) {}
  if (contesto) {
    for (const p of contesto.pages()) aggancia(p);
    contesto.on('page', aggancia);
  }
  const timer = setInterval(() => { prendi().catch(() => {}); }, OGNI_MS);
  timer.unref?.();
  const nome = join(dir, `pagine-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  let scritto = false;
  const scrivi = () => {
    if (scritto) return;
    scritto = true;
    clearInterval(timer);
    const indirizzi = {};
    for (const [u, set] of viste) indirizzi[u] = [...set].map((x) => x.split(':').map(Number));
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(nome, JSON.stringify({ prova, processo: 'pagine', indirizzi }));
    } catch (_) {}
  };
  const chiudi = app.close.bind(app);
  app.close = async () => {
    await Promise.race([prendi().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    scrivi();
    return chiudi();
  };
  app.once('close', scrivi);
}

export function accendiCopertura() {
  const dir = process.env.FILO_COPERTURA;
  if (!dir) return;
  const proto = Object.getPrototypeOf(_electron);
  if (proto.__filoCopertura) return;
  proto.__filoCopertura = true;
  const launch = proto.launch;
  proto.launch = async function launchConCopertura(options = {}) {
    const prova = provaInCorsa();
    const env = { ...(options.env || process.env), FILO_COPERTURA: resolve(dir), FILO_COPERTURA_PROVA: prova };
    const app = await launch.call(this, { ...options, env });
    segui(app, prova, resolve(dir));
    return app;
  };
}
