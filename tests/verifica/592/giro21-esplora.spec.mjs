// Esplorazione del giro 21 (#592): l'Aiuto su una pagina web vera, lo stile
// proposto dal modello, il popup e le Preferenze in chiaro e in scuro.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function isolato(app, page) {
  const cdp = await app.context().newCDPSession(page);
  const ctx = [];
  cdp.on('Runtime.executionContextCreated', (e) => ctx.push(e.context));
  await cdp.send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 200));
  let id = null;
  for (const c of ctx) {
    const r = await cdp.send('Runtime.evaluate', { contextId: c.id, expression: 'typeof window.SN_SIDEBAR', returnByValue: true }).catch(() => null);
    if (r && r.result && r.result.value === 'object') { id = c.id; break; }
  }
  if (id == null) throw new Error('mondo isolato non trovato: ' + JSON.stringify(ctx.map((c) => c.name)));
  return async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { contextId: id, expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
}
const storedStyle = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.agentStyle || ''));

test('Aiuto su pagina web: stile proposto → popup → OK salva', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<html><body><h1>Pizzeria</h1><p>Margherita 7 euro.</p></body></html>');
  const iso = await isolato(app, page);
  await iso('window.SN_SIDEBAR.open(); true');
  await page.waitForTimeout(500);
  await iso(`window.__corsa = window.__filoSidebarTest.runFiloAction({ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Rispondi breve e dammi del tu.' }); true`);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  const st = await iso('JSON.stringify(window.SN_CONFIRM_UI._test.state())');
  console.log('STATO', st);
  await page.screenshot({ path: 'tests/.shots/g21-aiuto-web-popup.png' });
  const p = await iso(`window.SN_CONFIRM_UI._test.point('ok')`);
  console.log('PUNTO', JSON.stringify(p));
  await page.mouse.click(p.x, p.y);
  const esito = await iso('window.__corsa');
  console.log('ESITO', esito);
  await expect.poll(() => storedStyle(app), { timeout: 5000 }).toBe('Rispondi breve e dammi del tu.');
  await page.screenshot({ path: 'tests/.shots/g21-aiuto-web-dopo.png' });
});
