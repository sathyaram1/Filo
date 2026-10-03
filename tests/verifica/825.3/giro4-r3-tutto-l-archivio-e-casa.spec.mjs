// «Cancella tutto l'archivio»: le pagine della rete di casa non restano fuori in silenzio.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configure, fakeChat, seedArchive, chiedi } from './_comune.mjs';

test('richiesta di cancellare tutto: il pannello propone anche le pagine di casa, o dice che le ha lasciate fuori', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app);
  await seedArchive(app, [
    { title: 'Gatti persiani' },
    { title: 'Ricetta della torta' },
    { title: 'Pannello del router', url: 'http://192.168.1.1/' },
  ], { tutte: true });
  await fakeChat(app, [
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"tutte le schede"}' }] },
    { text: 'Ecco tutto l\'archivio.' },
  ]);
  await chiedi(page, 'svuota tutto l\'archivio delle schede');
  const panel = page.locator('.dash-delete-panel');
  await expect(panel.locator('.dash-delete-list li')).not.toHaveCount(0, { timeout: 15_000 });
  const testo = await panel.innerText();
  expect(/Pannello del router/.test(testo) || /rete di casa|non (le )?ho guardat/i.test(testo),
    `il pannello tace sulla pagina del router: ${testo}`).toBe(true);
});
