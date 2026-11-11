// Verifica #2344 giro 1, rilievo 2: in Gestione → Automazioni la scelta dello sforzo della verifica dopo un
// riallineamento è un costo contro qualità; chi la cambia deve leggere accanto la stima (costo al mese e tempo).
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

async function owner(app) {
  await app.evaluate(async (electron) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url) => (/documents\/config\/routines\?/.test(String(url))
      ? risposta(true, { fields: { enabled: { booleanValue: true } } })
      : risposta(false, {}, 503));
  });
}

test('r2 lo sforzo della verifica dopo un riallineamento porta accanto la sua stima di costo al mese e di tempo', async ({ app, openTab }) => {
  await owner(app);
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_ROUTINE_MODELLI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await apriScheda(page, 'automation');
  const blocco = page.locator('#mgRoleModelsBlock');
  await expect(page.locator('select[data-ruolo="verifier-riallineamento"][data-campo="effort"]')).toHaveCount(1);
  await blocco.screenshot({ path: 'tests/.shots/2344-giro1-sforzo-riallineamento.png' });
  const testi = await page.evaluate(() => {
    const sel = document.querySelector('select[data-ruolo="verifier-riallineamento"][data-campo="effort"]');
    const riquadro = document.getElementById('mgRoleModelsBlock');
    return [riquadro.innerText, ...Array.from(sel.options).map((o) => o.textContent), sel.closest('.sn-select-wrap')?.title || ''].join('\n');
  });
  expect(testi, 'nessuna stima di costo al mese accanto alla scelta').toMatch(/al mese/i);
});
