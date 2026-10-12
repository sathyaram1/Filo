// #1167, giro 2: il bottone del file chiamato insieme a un'altra azione. Il testo del giro va nelle note, ma l'esito
// del bottone dice al modello che l'utente lo sta già leggendo: un modello che obbedisce non lo ripete e la risposta resta sepolta.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';

async function bollettaTari(app) {
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Tasse');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'tari-2026.pdf');
  writeFileSync(file, '%PDF-1.4');
  return { dir, file };
}
const apriFile = (percorso, id) => ({ id, name: 'APRI_FILE', arguments: JSON.stringify({ percorso }) });

async function controlla(app, page, attesa) {
  const bolla = page.locator('.dash-bubble-filo');
  await expect(bolla.last()).toContainText(attesa, { timeout: 15_000 });
  const testo = await bolla.evaluate((el) => el.textContent);
  const esito = (await chiamateAlModello(app))[1].find((m) => m.role === 'tool' && m.tool_call_id === 'f1');
  // Al modello si può dire «l'utente la sta leggendo» solo se la risposta è davvero nella bolla.
  expect({ detto: esito.content.includes('non ripeterla'), nellaBolla: testo.includes(RISPOSTA) })
    .not.toEqual({ detto: true, nellaBolla: false });
}

test('r1 risposta col bottone del file e un promemoria nello stesso giro: la risposta arriva nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file, 'f1'), { id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: 'Fatto: il promemoria suona tra 5 minuti.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari? e ricordamelo tra 5 minuti');
    await controlla(app, page, 'Fatto: il promemoria');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r1 risposta con due bottoni di file, uno dei due non esiste: la risposta arriva nella bolla', async ({ app }) => {
  test.setTimeout(60_000);
  const { dir, file } = await bollettaTari(app);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [apriFile(file, 'f1'), apriFile(join(dir, 'tari-2025.pdf'), 'f2')] },
      { text: 'La bolletta del 2025 invece non l\'ho trovata.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari quest\'anno e l\'anno scorso?');
    await controlla(app, page, 'non l\'ho trovata');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
