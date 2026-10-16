// Verifica #905, giro 2, rilievo 2: la chiave di Safe Browsing e la password del proxy vanno sul disco in chiaro
// anche col portachiavi, e senza portachiavi nessun avviso lo dice.
import { test, expect } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHIAVE_SB = 'AIzaSyChiaveSafeBrowsingDiProva0123456';
const PASSWORD = 'password-del-proxy-987';

async function avvia(userData) {
  return electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
}

test('r2 col portachiavi la chiave di Safe Browsing e la password del proxy non stanno in chiaro sul disco', async () => {
  const userData = cartellaTemporanea('filo-v905-sb-');
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ settings: { theme: 'light' } }), 'utf8');
  const app = await avvia(userData);
  try {
    await app.evaluate(({ safeStorage }) => {
      safeStorage.isEncryptionAvailable = () => true;
      safeStorage.encryptString = (s) => Buffer.from(String(s), 'utf8').reverse();
      safeStorage.decryptString = (b) => Buffer.from(b).reverse().toString('utf8');
    });
    await primaFinestra(app);
    await app.evaluate(async (_electron, { k, p }) => {
      const s = await globalThis.SN_STORAGE.getSettings();
      await globalThis.SN_STORAGE.updateSettings({
        security: { ...s.security, safeBrowse: { ...(s.security?.safeBrowse || {}), safeBrowsingKey: k } },
        proxy: { ...(s.proxy || {}), datacenter: `http://mario:${p}@gate.example.com:8080` },
      });
      await globalThis.__filoStorage.whenSettled();
    }, { k: CHIAVE_SB, p: PASSWORD });
    const suDisco = readFileSync(join(userData, 'storage.json'), 'utf8');
    expect(suDisco.includes(CHIAVE_SB), 'la chiave di Safe Browsing non deve stare in chiaro').toBe(false);
    expect(suDisco.includes(PASSWORD), 'la password del proxy non deve stare in chiaro').toBe(false);
  } finally {
    try { await app.close(); } catch (_) {}
    rmSync(userData, { recursive: true, force: true });
  }
});
