// Verifica #1312 giro 1, rilievo 1: un comando che resta sul computer non porta fuori la password che contiene.
// A Normale, in una conversazione nuova, deve chiedere un OK come gli altri comandi che modificano, non dire di no.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r1 docker con la password del database, un .env, un export e un psql su localhost chiedono un OK, non un no', async ({ app }) => {
  await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true, shell: 'bash' }, autonomia: { livello: 'default' } }));
  const comandi = [
    'docker run -d -e POSTGRES_PASSWORD=example1 -p 5432:5432 postgres',
    'echo "DB_PASSWORD=dev12345" >> .env',
    'export DB_PASSWORD=dev12345',
    'psql "postgresql://postgres:postgres1@localhost:5432/app"',
  ];
  for (const comando of comandi) {
    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando }, { richiesta: 'preparami il database per il progetto' });
    expect(r.no, `${comando}: ${r.output && r.output.error}`).not.toBe(true);
    expect(r.needsConfirm, comando).toBeTruthy();
  }
});
