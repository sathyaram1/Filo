// Verifica #905.1 giro 1: il proxy «utente:password@indirizzo:porta» senza schema, dalla pagina Sicurezza.
// Senza la spunta esce il solo indirizzo; con la spunta esce intero. La casella compare anche nella conferma di «Cancella tutto».
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PASSWORD = 'passwordsegreta';
const PROXY = `mario:${PASSWORD}@gate.esempio.com:8080`;

test('proxy senza schema: la casella compare, senza spunta esce solo l’indirizzo, con la spunta intero', async () => {
  const userData = cartellaTemporanea('filo-9051-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { proxy: { datacenter: PROXY } } }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  try {
    let uscita = join(userData, 'senza.zip');
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__uscita });
    });
    const imposta = (p) => app.evaluate((_, q) => { globalThis.__uscita = q; }, p);
    await imposta(uscita);
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate(() => window.filoShell.tabs.open('filo://security/'));
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'security'; } catch (_) { return false; } });
      return !!page;
    }, { timeout: 10000 }).toBe(true);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#sec-export-keys-row'), 'la riga «Includi le chiavi» deve comparire').toBeVisible();
    await expect(page.locator('#sec-export-keys')).not.toBeChecked();
    await page.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(uscita), { timeout: 8000 }).toBe(true);
    const senza = readFileSync(uscita);
    expect(senza.includes(Buffer.from(PASSWORD)), 'senza spunta la password non esce').toBe(false);
    const dati = JSON.parse(execFileSync('unzip', ['-p', uscita, 'data.json'], { encoding: 'utf8' }));
    expect(dati.settings.proxy.datacenter).toBe('gate.esempio.com:8080');

    uscita = join(userData, 'con.zip');
    await imposta(uscita);
    await page.locator('#sec-export-keys').check();
    await page.locator('#sec-export-btn').click();
    await expect.poll(() => existsSync(uscita), { timeout: 8000 }).toBe(true);
    const conDati = JSON.parse(execFileSync('unzip', ['-p', uscita, 'data.json'], { encoding: 'utf8' }));
    expect(conDati.settings.proxy.datacenter, 'con la spunta il proxy esce intero').toBe(PROXY);
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'verifica-9051-sicurezza.png'), fullPage: true });
  } finally {
    await chiudiApp(app);
    rmSync(userData, { recursive: true, force: true });
  }
});
