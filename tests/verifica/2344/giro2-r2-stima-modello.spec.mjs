// Verifica #2344 giro 2, rilievo 2: in Gestione → Automazioni la stima accanto alla «Verifica dopo un riallineamento»
// deve seguire anche il modello scelto per la fase, non solo lo sforzo: con Haiku non può costare quanto con Opus.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import path from 'node:path';

async function serverFinto(app, roleModels) {
  await app.evaluate(async (electron, rm) => {
    const { createRequire } = process.getBuiltinModule('module');
    const p = process.getBuiltinModule('path');
    const req = createRequire(p.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(p.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const toFs = (v) => {
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return { integerValue: String(v) };
      const fields = {};
      for (const [k, x] of Object.entries(v)) fields[k] = toFs(x);
      return { mapValue: { fields } };
    };
    const doc = { fields: toFs({ enabled: true, maxSessions: 2, roleModels: rm }).mapValue.fields };
    const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url, init = {}) => {
      if (!/documents\/config\/routines\?/.test(String(url)) || (init.method || 'GET') !== 'GET') return risposta(false, {}, 503);
      return risposta(true, JSON.parse(JSON.stringify(doc)));
    };
  }, roleModels);
}

async function stima(page) {
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await apriScheda(page, 'automation');
  const s = page.locator('.mg-role-stima[data-ruolo="verifier-riallineamento"]');
  await expect(s).toHaveText(/al mese/);
  return s.textContent();
}

test('r2 la stima della verifica dopo un riallineamento cambia col modello della fase', async ({ app, openTab }) => {
  await serverFinto(app, { 'verifier-riallineamento': { model: 'opus', effort: 'medium' } });
  const page = await openTab('filo://manage/manage.html');
  const conOpus = await stima(page);
  await page.locator('#mgRoleModels').screenshot({ path: path.join('tests', '.shots', 'verifica-2344-giro2-automazioni.png') });
  await serverFinto(app, { 'verifier-riallineamento': { model: 'haiku', effort: 'medium' } });
  await page.reload();
  const conHaiku = await stima(page);
  await expect(page.locator('select[data-ruolo="verifier-riallineamento"][data-campo="model"]')).toHaveValue('haiku');
  expect(conHaiku, `con Haiku la stima resta quella di Opus: «${conHaiku}»`).not.toBe(conOpus);
});
