// Verifica #823 giro 2. r1: una regola salvata per un nome di rete senza punto (il NAS) si toglie dicendone il nome.
// r2: un dominio di primo livello da solo («com» con lo schema) non diventa una regola che tiene aperto mezzo web.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test.use({ hostInPiu: ['nas'] });

const pagina = (titolo) => `<!doctype html><html><head><title>${titolo}</title></head><body><p>${titolo}</p></body></html>`;
const regole = (app) => app.evaluate(async () => Object.keys(await globalThis.SN_FILO_MEMORY.listKeepOpen()));

test('r1 «non tenere più aperto il nas»: la regola salvata dalla scheda del NAS si toglie col suo nome', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await openTab(testServer.html(pagina('NAS')).replace('127.0.0.1', 'nas'));
  await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url)))
    .some((u) => u.startsWith('http://nas:'))).toBe(true);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a1', name: 'TIENI_APERTA', arguments: JSON.stringify({}) }] },
    { text: 'Fatto.' },
  ]);
  const chat = await home(app);
  await chiedi(chat, 'tienimi sempre aperta questa scheda');
  await expect(chat.locator('.dash-bubble-filo').last()).toContainText('Fatto.', { timeout: 15_000 });
  await ripristina(app);
  expect(await regole(app)).toEqual(['nas']);

  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NON_TENERE_APERTA', arguments: JSON.stringify({ dominio: 'nas' }) }] },
    { text: 'Tolto.' },
  ]);
  await chiedi(chat, 'non tenere più aperto il nas');
  await expect(chat.locator('.dash-bubble-filo').last()).toContainText('Tolto.', { timeout: 15_000 });
  const esito = (await chiamateAlModello(app))[1].find((m) => m.role === 'tool' && m.tool_call_id === 'n1');
  await ripristina(app);
  expect(await regole(app), `esito dato al modello: ${esito && esito.content}`).toEqual([]);
});

test('r2 «https://com» non diventa una regola: terrebbe aperti tutti i siti .com', async ({ app }) => {
  test.setTimeout(60_000);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'TIENI_APERTA', arguments: JSON.stringify({ dominio: 'https://com' }) }] },
    { text: 'Ok.' },
  ]);
  const chat = await home(app);
  await chiedi(chat, 'tienimi sempre aperti i siti com');
  await expect(chat.locator('.dash-bubble-filo').last()).toContainText('Ok.', { timeout: 15_000 });
  await ripristina(app);
  const voci = await regole(app);
  expect(voci).toEqual([]);
  expect(await app.evaluate((_e, v) => v.map((x) => globalThis.SN_TAB_TRIAGE.voceTenuta('https://www.google.com/', [x])), voci)).toEqual([]);
});
