// Esplorazione del giro 3 (#1926): Automazioni al buio e coi testi lunghi; si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { MANAGE } from '../../helpers/gestioneMainFinto.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots');

test('esplora Automazioni al buio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo && window.__mgStrumenti);
  await page.evaluate(() => {
    const s = window.__srv = { keys: [
      { slug: 'cloud-a', scope: 'routine', account: 'A', rete: 'limitata', lastUsedAt: '2026-11-03T08:00:00Z', label: 'Una descrizione abbastanza lunga da andare a capo nella riga della chiave di routine, per vedere come si comporta' },
      { slug: 'a'.repeat(63), scope: 'sessione' },
      { slug: 'vecchia', scope: 'manutentore', revoked: true },
    ], chiamate: [] };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      s.chiamate.push(msg);
      if (t === 'auth_status') return { ok: true, isAdmin: true, signedIn: true };
      if (t === 'routine_chiavi_elenco') return { ok: true, keys: JSON.parse(JSON.stringify(s.keys)) };
      if (t === 'routine_chiave_crea') { s.keys.push({ slug: msg.slug, scope: msg.scope, label: msg.label }); return { ok: true, slug: msg.slug, scope: msg.scope, passphrase: 'una-parola-molto-lunga-'.repeat(4) }; }
      if (t === 'routine_chiusura_get') return { ok: true, slots: [{ slot: 'worker', testo: 'Cosa ti è mancato?' }], ripiego: 'Ripiego.', risposte: [] };
      if (t === 'manutentore_recap_get') return { ok: true, recap: [], stato: { parallelismo: 4, parallelismoEffettivo: 4, freno: 20, ordine: ['812'] } };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.emulateMedia({ colorScheme: 'dark' });
  await apriScheda(page, 'automation');
  await expect(page.locator('#mgChiaviLista .mg-ac-riga')).toHaveCount(3);
  await page.locator('#mgChiaveNome').fill('pc-sessioni');
  await page.locator('#mgChiavePotere').selectOption('sessione');
  await page.locator('#mgChiaveCrea').click();
  await expect(page.locator('#mgChiaveNata')).toBeVisible();
  mkdirSync(SHOTS, { recursive: true });
  await page.locator('#mgAccessi').screenshot({ path: join(SHOTS, 'g3-accessi-scuro.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('#mgAccessi').screenshot({ path: join(SHOTS, 'g3-accessi-chiaro.png') });
  await page.locator('#mgChiaveCopia').click();
  await page.waitForTimeout(300);
  console.log('msg copia:', await page.locator('#mgChiaveMsg').innerText());
  console.log('appunti:', await page.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e.message)));
  // Doppio clic veloce su Crea con lo stesso nome: quante nascono?
  await page.locator('#mgChiaveFatto').click();
  await page.locator('#mgChiaveNome').fill('doppia');
  await page.locator('#mgChiaveCrea').dblclick();
  await page.waitForTimeout(800);
  const nate = await page.evaluate(() => window.__srv.chiamate.filter((c) => c.type === 'routine_chiave_crea' && c.slug === 'doppia').length);
  console.log('crea doppia:', nate);
});
