// Verifica #1318 giro 2, rilievo 4: il secondo documento letto nello stesso compito si giudica sul percorso pulito, come
// lo legge la lettura: «file://» o le caporali non cambiano cosa Filo chiede o rifiuta.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';

const homeDiFilo = async (app, shell) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  let home = null;
  await expect.poll(() => { home = app.windows().find((w) => w.url().startsWith('filo://newtab')); return Boolean(home); }).toBe(true);
  await home.waitForFunction(() => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage);
  return home;
};
const scrivi = (base, nome) => {
  const dir = join(base, `filo-verifica-1318-${process.pid}`, nome);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'nota prova.txt');
  writeFileSync(f, `contenuto ${nome}`);
  return f;
};
const comeIndirizzo = (f) => 'file://' + f.split('/').map(encodeURIComponent).join('/');
test.afterEach(() => { rmSync(join(homedir(), `filo-verifica-1318-${process.pid}`), { recursive: true, force: true }); });

test('r4 un secondo documento della cartella personale scritto come «file://» si legge come scritto nudo', async ({ app, shell }) => {
  test.skip(process.platform === 'win32', 'percorso Linux/Mac');
  const primo = scrivi(homedir(), 'primo');
  const secondo = scrivi(homedir(), 'secondo');
  const home = await homeDiFilo(app, shell);
  const leggi = (p) => home.evaluate((x) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'LEGGI_DOCUMENTO', percorso: x } }), p);
  expect((await leggi(primo)).executed).toBe(true);
  const r = await leggi(comeIndirizzo(secondo));
  expect(r.describe || '', 'nessuna conferma con un motivo falso').not.toContain('dati del sistema che non sono file');
  expect(r.executed, 'scritto nudo si legge senza chiedere').toBe(true);
  expect(r.output && r.output.text).toContain('contenuto secondo');
});

test('r4 un secondo documento fuori dalla cartella personale fra caporali chiede conferma come scritto nudo, non viene rifiutato', async ({ app, shell }) => {
  test.skip(process.platform === 'win32', 'percorso Linux/Mac');
  const base = join(homedir(), '..');
  let secondo;
  try { secondo = scrivi(base, 'fuori'); } catch (_) { test.skip(true, 'nessuna cartella scrivibile fuori dalla home'); }
  try {
    const primo = scrivi(homedir(), 'primo');
    const home = await homeDiFilo(app, shell);
    const leggi = (p) => home.evaluate((x) => chrome.runtime.sendMessage({ type: 'filo_run_action', action: { type: 'LEGGI_DOCUMENTO', percorso: x } }), p);
    expect((await leggi(primo)).executed).toBe(true);
    const nudo = await leggi(secondo);
    const caporali = await leggi(`«${secondo}»`);
    expect(Boolean(nudo.needsConfirm), 'scritto nudo chiede conferma').toBe(true);
    expect(caporali.output && caporali.output.error, 'fra caporali non viene rifiutato').not.toBe('fuori_perimetro');
    expect(Boolean(caporali.needsConfirm), 'fra caporali chiede conferma come scritto nudo').toBe(true);
  } finally {
    rmSync(join(base, `filo-verifica-1318-${process.pid}`), { recursive: true, force: true });
  }
});
