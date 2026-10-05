// #758 giro 4, rilievo 1: il cookie partizionato che lo script di un riquadro mette con una scadenza non deve
// sopravvivere a una chiusura di Filo che non passa dall'uscita normale (spegnimento del sistema, chiusura forzata).
import { test, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function lancia(userData) {
  const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
  const shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

const persistentiDiB = (app) => app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({ domain: 'b.localhost' }))
  .filter((c) => !c.session).map((c) => c.name).sort());

test('il cookie partizionato dello script di un riquadro non resta dopo una chiusura brusca di Filo', async () => {
  test.setTimeout(90_000);
  const server = createServer((req, res) => {
    const porta = server.address().port;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/riquadro')) {
      res.end('<p>riquadro</p><script>document.cookie = "jschips=1; max-age=3600; path=/; SameSite=None; Secure; Partitioned";</script>');
    } else {
      res.end(`<title>ARTICOLO</title><iframe src="http://b.localhost:${porta}/riquadro"></iframe>`);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  const ud = cartellaTemporanea('filo-v758-');
  let app = null;
  try {
    let shell;
    ({ app, shell } = await lancia(ud));
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `http://a.localhost:${porta}/`);
    await expect.poll(() => persistentiDiB(app), { timeout: 10_000 }).toEqual(['jschips']);
    // Il cookie è già sul disco, come dopo qualche secondo di lettura; poi Filo si chiude senza l'uscita normale.
    await app.evaluate(async ({ session }) => { await session.defaultSession.cookies.flushStore(); });
    process.kill(app.process().pid, 'SIGKILL');
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
    await new Promise((r) => setTimeout(r, 1000));
    ({ app } = await lancia(ud));
    await new Promise((r) => setTimeout(r, 3000));
    expect(await persistentiDiB(app)).toEqual([]);
  } finally {
    if (app) await app.close().catch(() => {});
    if (server.listening) await new Promise((r) => server.close(r));
    try { rmSync(ud, { recursive: true, force: true }); } catch (_) {}
  }
});
