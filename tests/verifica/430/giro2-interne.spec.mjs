// Verifica #430 giro 2 — esplorazione: le pagine di Filo (cronologia, preferenze) lasciate dietro hanno la foto.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { pagina, schede, idDi, carta } from './giro2-carta.mjs';

test('cronologia e preferenze lasciate dietro: la carta mostra la loro foto', async ({ app, shell, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const apri = async (u) => { await shell.evaluate((x) => window.filoShell.tabs.open(x), u); return idDi(app, (t) => t.url.startsWith(u)); };
  const h = await apri('filo://history/history.html');
  await shell.waitForTimeout(800);
  const p = await apri('filo://preferences/preferences.html');
  await shell.waitForTimeout(800);
  const u = testServer.html(pagina('#1030d0', 'Blu'));
  await apri(u);
  await expect.poll(async () => { const s = await schede(app); return [h, p].every((id) => s.tutte.find((t) => t.id === id)?.foto); }, { timeout: 10_000 }).toBe(true);
  await shell.mouse.move(600, 500);
  await shell.waitForTimeout(900);
  const win = () => app.windows().find((w) => { try { return w.url() === 'filo://shell/anteprima.html'; } catch (_) { return false; } });
  await shell.locator(`.tab[data-id="${h}"]`).hover();
  await expect.poll(async () => (await carta(app)).visibile, { timeout: 3000 }).toBe(true);
  await shell.waitForTimeout(300);
  await win().screenshot({ path: 'tests/.shots/430-g2-cronologia.png' });
  await shell.locator(`.tab[data-id="${p}"]`).hover();
  await shell.waitForTimeout(400);
  await win().screenshot({ path: 'tests/.shots/430-g2-preferenze.png' });
  const c = await carta(app);
  console.log('PREFERENZE', c.titolo, JSON.stringify(c.colore));
});
