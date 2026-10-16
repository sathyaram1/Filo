// Verifica #850 giro 1: il riavvio vero (non quello finto delle prove) svuota la cartella, e l'aspetto della conferma.
import { test, expect, argomentiScala } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const SEGNO = `--verifica-850-${process.pid}`;

const fileSotto = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    let st; try { st = lstatSync(p); } catch (_) { continue; }
    if (st.isDirectory()) fileSotto(p, out); else if (st.isFile()) out.push(p);
  }
  return out;
};
const contengono = (dir, ago) => fileSotto(dir).filter((f) => { try { return readFileSync(f, 'latin1').includes(ago); } catch (_) { return false; } });
const vivi = () => { try { return execSync(`pgrep -f -- "${SEGNO}"`).toString().trim().split('\n').filter(Boolean); } catch (_) { return []; } };

async function avvia(userData, tema) {
  const app = await electron.launch({
    args: [...argomentiScala, '.', SEGNO],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  if (tema) await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
  return { app, shell };
}

async function sicurezza(app, shell) {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://security/')), { timeout: 15_000 }).toBe(true);
  const page = app.windows().find((w) => w.url().startsWith('filo://security/'));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test('il riavvio vero di Filo svuota la cartella e riparte', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-v850-');
  try {
    const { app, shell } = await avvia(userData);
    await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta VRF850' }));
    await app.evaluate(() => globalThis.__filoStorage.flushNow());
    expect(contengono(userData, 'VRF850').length).toBeGreaterThan(0);
    // Il riavvio di produzione, senza la guardia delle prove.
    await app.evaluate(({ app: a }) => { globalThis.__filoCancellaTutto.dip.riapri = () => a.relaunch(); });
    const page = await sicurezza(app, shell);
    await page.locator('#sec-wipe-btn').click();
    await page.locator('#sec-wipe-word').fill('conferma');
    await page.locator('#sec-wipe-go').click();
    const proc = app.process();
    if (proc.exitCode === null) await new Promise((r) => proc.once('exit', r));
    // La copia nuova nasce da sola, svuota e si tiene la cartella.
    await expect.poll(() => vivi().length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => existsSync(join(userData, 'cancella-tutto.json')), { timeout: 30_000 }).toBe(false);
    await expect.poll(() => existsSync(join(userData, 'storage.json')), { timeout: 30_000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    expect(contengono(userData, 'VRF850')).toEqual([]);
    expect(vivi().length).toBeGreaterThan(0);
  } finally {
    try { execSync(`pkill -f -- "${SEGNO}"`); } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
    togliCartella(userData);
  }
});

for (const tema of ['light', 'dark']) {
  test(`aspetto della conferma, tema ${tema}`, async () => {
    const userData = cartellaTemporanea('filo-v850-');
    const { app, shell } = await avvia(userData, tema);
    try {
      const page = await sicurezza(app, shell);
      await page.setViewportSize?.({ width: 1100, height: 900 }).catch(() => {});
      await page.locator('#sec-wipe-btn').click();
      await expect(page.locator('#sec-wipe-box')).toBeVisible();
      mkdirSync(SHOTS, { recursive: true });
      await page.locator('#sec-wipe-btn').hover();
      await page.locator('#sec-wipe-box').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(SHOTS, `v850-${tema}-spento.png`) });
      await page.locator('#sec-wipe-word').fill('conferma');
      await page.locator('#sec-wipe-go').hover();
      await page.screenshot({ path: join(SHOTS, `v850-${tema}-acceso.png`) });
    } finally {
      try { await app.close(); } catch (_) {}
      togliCartella(userData);
    }
  });
}
