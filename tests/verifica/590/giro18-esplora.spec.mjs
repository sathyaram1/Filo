// Verifica #590, giro 18: esplorazione.

import { test, expect, lista, schede, contaAvvisi, idAttiva, schedaSu } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const naviga = (url, id = 'n1', extra = {}) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina', ...extra }) });
const risposteAlModello = async (app, giro) => JSON.stringify(((await chiamateAlModello(app))[giro] || []).filter((m) => m && m.role === 'tool'));

const statoSchede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w._filoTabs.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, caricata: t.view.webContents.getURL(), storia: (() => { try { return t.view.webContents.navigationHistory.length(); } catch (_) { return -1; } })() }));
});

test('A: dalla barra di una pagina interna, un indirizzo che rimbalza sul sito della lista', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await shell.waitForTimeout(1500);
  const id = await idAttiva(app);
  console.log('PRIMA', JSON.stringify(await statoSchede(app)));
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, corto]);
  await shell.waitForTimeout(2500);
  const dopo = await statoSchede(app);
  console.log('DOPO', JSON.stringify(dopo));
  console.log('AVVISI', JSON.stringify(await avvisi()));
  const s = dopo.find((t) => t.id === id);
  // Successo per l'utente: la scheda mostra qualcosa (la pagina di prima o «Sito bloccato»), non un vuoto.
  expect(s && s.caricata).toBeTruthy();
});

test('B: NAVIGA verso una pagina che rimanda da sé a un accorciatore che rimbalza sul sito della lista', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.rimbalzo('accorcia.test', '/r', bersaglio);
  const ponte = rete.pagina('sito.test', '/ponte', `<h1>Stai lasciando il sito…</h1><script>location.replace(${JSON.stringify(corto)})</script>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'RISPOSTA' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    console.log('SCHEDE', JSON.stringify(await statoSchede(app)));
    console.log('AVVISI', JSON.stringify(await avvisi()));
    const tool = await risposteAlModello(app, 1);
    console.log('TOOL', tool);
    const activity = page.locator('.dash-activity');
    await activity.locator('.dash-activity-head').click();
    console.log('DIARIO', await activity.innerText());
    expect((await schede(app)).filter((u) => u.includes('blocked.test'))).toEqual([]);
    expect(tool).toContain('NON aperta');
  } finally {
    await ripristina(app);
  }
});

test('C: NAVIGA fermata, poi la home ricaricata: «Apri comunque» è ancora in chat', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(bersaglio)] }, { text: 'NON APERTA' }]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'NON APERTA' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Apri comunque', exact: true })).toBeVisible();
    await page.screenshot({ path: 'tests/.shots/590-g18-chat-apri.png' });
    await page.reload();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tests/.shots/590-g18-chat-apri-ricaricata.png' });
    console.log('BOTTONI DOPO RICARICA', await page.getByRole('button', { name: 'Apri comunque', exact: true }).count());
  } finally {
    await ripristina(app);
  }
});
