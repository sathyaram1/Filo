// Lista dei siti bloccati (#590) vista dalla chat della home: cosa sa il modello di un'apertura fermata,
// quando lo sa, e l'«Apri comunque» che la chat tiene dopo che la notifica se n'è andata.
// Rete finta: tests/helpers/reteFinta.mjs; modello finto: tests/helpers/chatFinta.mjs.

import { test, expect, lista, schede, contaAvvisi } from './helpers/reteFinta.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from './helpers/chatFinta.mjs';

const naviga = (url, id = 'n1', extra = {}) => ({ id, name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'pagina', ...extra }) });
const risposteAlModello = async (app, giro) => JSON.stringify(((await chiamateAlModello(app))[giro] || []).filter((m) => m && m.role !== 'system'));
const suBloccato = async (app) => (await schede(app)).filter((u) => u.includes('blocked.test'));

test('NAVIGA verso una pagina che dichiara di rimandare al sito della lista dopo un secondo: il modello sa che non si è aperta', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/p', `<meta http-equiv="refresh" content="1;url=${bersaglio}"><h1>Stai lasciando il sito…</h1>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'RISPOSTA' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 1)).toContain('Pagina NON aperta');
    await expect(page.getByRole('button', { name: 'Apri comunque', exact: true })).toBeVisible();
  } finally {
    await ripristina(app);
  }
});

test('tre NAVIGA nello stesso giro: le schede nascono insieme, non una dopo il caricamento dell\'altra', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const urls = ['/a', '/b', '/c'].map((p) => rete.pagina('libero.test', p, `<h1>${p}</h1>`, { ritardoMs: 800 }));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: urls.map((u, i) => naviga(u, `n${i}`, { background: true })) }, { text: 'Aperte.' }]);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__nascite = [];
    const orig = w._filoTabs.openTab.bind(w._filoTabs);
    w._filoTabs.openTab = (u, o) => { globalThis.__nascite.push(Date.now()); return orig(u, o); };
  });
  try {
    await chiedi(page, 'apri le tre pagine');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aperte' })).toBeVisible({ timeout: 30_000 });
    const nascite = await app.evaluate(() => globalThis.__nascite);
    expect(nascite).toHaveLength(3);
    expect(nascite[2] - nascite[0]).toBeLessThan(500);
  } finally {
    await ripristina(app);
  }
});

test('NAVIGA fermata dalla lista: andata via la notifica, «Apri comunque» resta in chat e apre il sito una volta sola', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await home(app);
  // La risposta di un modello vero, dopo l'esito dell'azione, arriva dopo qualche secondo.
  await modelloFinto(app, [{ toolCalls: [naviga(bersaglio)] }, { ritardoMs: 3000, text: 'Non l’ho aperta: è fra i siti che hai bloccato.' }]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 1)).toContain('sotto la tua risposta c\'è «Apri comunque»');
    await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(0, { timeout: 8000 });
    const bottone = page.getByRole('button', { name: 'Apri comunque', exact: true });
    await expect(bottone).toBeVisible();
    await bottone.dblclick();
    await expect.poll(async () => (await suBloccato(app)).length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(800);
    expect(await suBloccato(app)).toEqual([bersaglio]);
  } finally {
    await ripristina(app);
  }
});

const ponteLento = (bersaglio, ms) => `<h1>Stai lasciando il sito…</h1><script>setTimeout(() => location.replace(${JSON.stringify(bersaglio)}), ${ms})</script>`;

test('la pagina aperta da NAVIGA che più tardi si sposta da sé sul sito della lista: la chat lo dice, e il modello al turno dopo', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/lento', ponteLento(bersaglio, 2500));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { text: 'Ecco la pagina.' }, { text: 'SECONDO-TURNO' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.dash-action-link-chip')).toBeVisible();
    await expect.poll(async () => (await avvisi()).length, { timeout: 8000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Apri comunque', exact: true })).toBeVisible({ timeout: 4000 });
    await expect(page.locator('.dash-action-link-chip')).toHaveCount(0);
    await expect(page.locator('.dash-bubble-actions')).toContainText('Link non aperto · blocked.test è fra i siti bloccati');

    await chiedi(page, 'si è aperta?');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'SECONDO-TURNO' })).toBeVisible({ timeout: 20_000 });
    expect(await risposteAlModello(app, 2)).toContain('si sono spostate da sole su un sito bloccato');
  } finally {
    await ripristina(app);
  }
});

test('il blocco più tardivo arriva mentre il modello sta ancora rispondendo: la chat lo dice lo stesso', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const ponte = rete.pagina('accorcia.test', '/lento', ponteLento(bersaglio, 2500));
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(ponte)] }, { ritardoMs: 4000, text: 'Ecco la pagina.' }]);
  try {
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Apri comunque', exact: true })).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.dash-action-link-chip')).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});

test('dopo un clic dell\'utente nella pagina aperta da NAVIGA, un sito della lista fermato non cambia la chat', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const aperta = rete.pagina('libero.test', '/', `<a id="l" href="${bersaglio}" style="font-size:40px">vai</a>`);
  const page = await home(app);
  await modelloFinto(app, [{ toolCalls: [naviga(aperta)] }, { text: 'Ecco la pagina.' }]);
  try {
    await chiedi(page, 'apri quella pagina');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco la pagina' })).toBeVisible({ timeout: 20_000 });
    const tab = app.windows().find((w) => w.url().includes('libero.test'));
    await tab.click('#l');
    await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first()).toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.dash-action-link-chip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apri comunque', exact: true })).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
