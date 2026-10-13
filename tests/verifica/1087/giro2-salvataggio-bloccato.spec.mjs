// Verifica #1087 giro 2: con la cartella dei dati che rifiuta le scritture il file di prima resta, l'avviso arriva,
// e quando la cartella torna scrivibile Filo salva da solo e lo dice. La cartella si blocca con chattr +i (Linux, root).

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');

function chattrPossibile() {
  if (process.platform !== 'linux') return false;
  const d = cartellaTemporanea('filo-chattr-');
  try {
    execFileSync('chattr', ['+i', d]);
    try { writeFileSync(join(d, 'x'), 'x'); return false; } catch (_) { return true; } finally { execFileSync('chattr', ['-i', d]); }
  } catch (_) { return false; } finally { rmSync(d, { recursive: true, force: true }); }
}

async function finestra(app, prova, timeout = 20_000) {
  const scadenza = Date.now() + timeout;
  while (Date.now() < scadenza) {
    const w = app.windows().find((p) => { try { return prova(p.url()); } catch (_) { return false; } });
    if (w) return w;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

test('cartella dei dati bloccata: file di prima intatto, avviso, poi salvataggio da solo quando si sblocca', async () => {
  test.skip(!chattrPossibile(), 'serve chattr +i');
  const dati = cartellaTemporanea('filo-bloccata-');
  writeFileSync(join(dati, 'storage.json'), JSON.stringify({ sn_nota_prova: 'prima' }));
  let app;
  let bloccata = false;
  try {
    app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' } });
    await app.firstWindow();
    await app.evaluate(async () => { await globalThis.SN_STORAGE.getRaw('sn_nota_prova', null); });
    // Le scritture dell'avvio (schede, impostazioni) vanno finite prima di bloccare.
    await new Promise((r) => setTimeout(r, 3000));
    const primaDelBlocco = readFileSync(join(dati, 'storage.json'), 'utf8');
    execFileSync('chattr', ['+i', dati]);
    bloccata = true;
    await app.evaluate(async () => { await globalThis.SN_STORAGE.setRaw('sn_nota_prova', 'dopo'); });
    // La vista degli avvisi nasce col primo avviso.
    const vista = await finestra(app, (u) => u.startsWith('filo://shell/avvisi.html'));
    expect(vista, 'la vista degli avvisi nasce').toBeTruthy();

    const carta = vista.locator('.shell-notif.show', { hasText: 'non riesce a salvare' });
    await expect(carta).toBeVisible({ timeout: 10_000 });
    mkdirSync(SHOTS, { recursive: true });
    await vista.screenshot({ path: join(SHOTS, 'verifica-1087-bloccata.png') });
    expect(readFileSync(join(dati, 'storage.json'), 'utf8'), 'il file di prima non si tocca').toBe(primaDelBlocco);

    execFileSync('chattr', ['-i', dati]);
    bloccata = false;
    await expect(vista.locator('.shell-notif.show', { hasText: 'di nuovo salvati' })).toBeVisible({ timeout: 20_000 });
    await vista.screenshot({ path: join(SHOTS, 'verifica-1087-sbloccata.png') });
    expect(JSON.parse(readFileSync(join(dati, 'storage.json'), 'utf8')).sn_nota_prova).toBe('dopo');
    expect(statSync(join(dati, 'storage.json')).size).toBeGreaterThan(10);
  } finally {
    if (bloccata) execFileSync('chattr', ['-i', dati]);
    if (app) await chiudiApp(app).catch(() => {});
    rmSync(dati, { recursive: true, force: true });
  }
});

test('storage.json che non si lascia leggere (è una cartella): Filo parte, lo dice, e alla chiusura non lo sovrascrive', async () => {
  const dati = cartellaTemporanea('filo-illeggibile-');
  mkdirSync(join(dati, 'storage.json'));
  writeFileSync(join(dati, 'storage.json', 'dentro'), 'resta');
  writeFileSync(join(dati, 'storage.json.bak'), JSON.stringify({ sn_nota_prova: 'dalla copia' }));
  let app;
  try {
    app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: dati, NODE_ENV: 'test' } });
    const vista = await finestra(app, (u) => u.startsWith('filo://shell/avvisi.html'));
    expect(vista).toBeTruthy();
    await expect(vista.locator('.shell-notif.show', { hasText: 'non riesce a leggere' })).toBeVisible({ timeout: 15_000 });
    const v = await app.evaluate(async () => globalThis.SN_STORAGE.getRaw('sn_nota_prova', null));
    expect(v).toBe('dalla copia');
    await app.evaluate(async () => { await globalThis.SN_STORAGE.setRaw('sn_altro', 1); });
    await chiudiApp(app);
    app = null;
    expect(readFileSync(join(dati, 'storage.json', 'dentro'), 'utf8')).toBe('resta');
    expect(JSON.parse(readFileSync(join(dati, 'storage.json.bak'), 'utf8')).sn_nota_prova).toBe('dalla copia');
  } finally {
    if (app) await chiudiApp(app).catch(() => {});
    rmSync(dati, { recursive: true, force: true });
  }
});
