// Giro 17 di #590, rilievo 1: la chat conosce l'esito di NAVIGA solo aspettando una finestra fissa, una scheda alla volta.
import { test, expect, lista, contaAvvisi } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/modello17.mjs';

test('NAVIGA verso una pagina che rimanda al sito della lista dopo un secondo: il modello sa che non si è aperta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/p', `<meta http-equiv="refresh" content="1;url=${bersaglio}"><h1>Stai lasciando il sito…</h1>`);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: ponte, etichetta: 'pagina' }) }] },
    { text: 'Fatto.' },
  ]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto' })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await avvisi()).length, { timeout: 8000 }).toBeGreaterThan(0);
    const secondo = JSON.stringify((await chiamateAlModello(app))[1] || []);
    expect(secondo).toContain('Pagina NON aperta');
  } finally {
    await ripristina(app);
  }
});

test('tre NAVIGA nello stesso giro: le tre schede nascono insieme', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const urls = ['/a', '/b', '/c'].map((p) => rete.pagina('libero.test', p, `<h1>${p}</h1>`, { ritardoMs: 800 }));
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: urls.map((u, i) => ({ id: `n${i}`, name: 'NAVIGA', arguments: JSON.stringify({ url: u, etichetta: `p${i}`, background: true }) })) },
    { text: 'Aperte.' },
  ]);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__nascite17 = [];
    const orig = w._filoTabs.openTab.bind(w._filoTabs);
    w._filoTabs.openTab = (u, o) => { globalThis.__nascite17.push(Date.now()); return orig(u, o); };
  });
  try {
    await chiedi(page, 'apri le tre pagine');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aperte' })).toBeVisible({ timeout: 30_000 });
    const nascite = await app.evaluate(() => globalThis.__nascite17);
    expect(nascite).toHaveLength(3);
    // Prima di questo lavoro nascevano nello stesso istante; una pagina lenta non deve far aspettare le altre.
    expect(nascite[2] - nascite[0]).toBeLessThan(500);
  } finally {
    await ripristina(app);
  }
});
