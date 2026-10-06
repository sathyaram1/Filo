// Esplorazione del giro 17 (si cancella): Sicurezza con molte scelte, nei due temi; cambio da Consenti a Blocca; disco.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('Sicurezza: elenco, cambio scelta, disco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync(SHOTS, { recursive: true });
  await app.evaluate(() => {
    const P = globalThis.__filoPermessi;
    P.imposta(null, 'https://www.un-nome-di-dominio-molto-molto-lungo-per-vedere-se-va-a-capo.esempio-lunghissimo.it', 'camera', 'consenti');
    P.imposta(null, 'https://www.un-nome-di-dominio-molto-molto-lungo-per-vedere-se-va-a-capo.esempio-lunghissimo.it', 'notifiche', 'nega');
    P.imposta(null, 'https://meet.example.com', 'microfono', 'consenti');
    P.imposta(null, 'https://meet.example.com', 'camera', 'consenti');
    P.imposta(null, 'http://localhost:8080', 'posizione', 'nega');
    P.imposta(null, 'https://xn--80ak6aa92e.com', 'appunti', 'consenti');
  });
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#perm-list .sn-perm-sito')).toHaveCount(4, { timeout: 10_000 });
  await sec.locator('#sec-permessi').scrollIntoViewIfNeeded();
  for (const tema of ['light', 'dark']) {
    await sec.emulateMedia({ colorScheme: tema });
    await sleep(400);
    await sec.locator('#sec-permessi').screenshot({ path: join(SHOTS, `586-giro17-sicurezza-${tema}.png`) });
  }
  const rigaCam = sec.locator('.sn-perm-sito[data-origine="https://meet.example.com"] .sn-perm-riga[data-tipo="camera"]');
  await rigaCam.locator('button[data-valore="nega"]').click();
  await expect.poll(() => app.evaluate(() => globalThis.__filoPermessi.elenco(null).find((x) => x.origine === 'https://meet.example.com').scelte.camera)).toBe('nega');
  await expect(rigaCam.locator('button[data-valore="nega"]')).toHaveAttribute('aria-pressed', 'true');
  await sleep(1500);
  const ud = await app.evaluate(({ app }) => app.getPath('userData'));
  const files = readdirSync(ud);
  console.log('file userData', files.join(','));
  const st = files.includes('storage.json') ? readFileSync(join(ud, 'storage.json'), 'utf8') : '';
  console.log('storage ha meet', st.includes('meet.example.com'), 'camera nega', /meet\.example\.com[^}]*camera[^}]*nega/.test(st));
  void shell; void testServer;
});
