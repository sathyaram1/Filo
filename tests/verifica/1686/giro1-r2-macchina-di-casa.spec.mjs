// Verifica #1686, rilievo 2: una macchina di casa senza punto che si chiama come un dominio di primo livello
// («casa», «media», «cloud», «box») con la sua porta deve poter restare sempre aperta, come «nas».

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const voci = (app) => app.evaluate(async () => Object.keys(await globalThis.SN_FILO_MEMORY.listKeepOpen()));

test('r2 «tienimi sempre aperto http://casa:8123» salva la macchina di casa', async ({ app }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 't1', name: 'TIENI_APERTA', arguments: JSON.stringify({ dominio: 'http://casa:8123' }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(chat, 'tienimi sempre aperto http://casa:8123');
  await expect.poll(() => voci(app), { timeout: 15_000 }).toContain('casa');
  await ripristina(app);
});
