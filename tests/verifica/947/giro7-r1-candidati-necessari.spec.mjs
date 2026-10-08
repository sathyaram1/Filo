// Verifica #947 giro 7. r1: «al modello va solo quello dei candidati necessari». Con la cartella della prova della
// segnalazione, per la bolletta della luce di marzo al modello arrivano anche la busta paga e la lettera di dimissioni,
// che combaciano solo con la parola «marzo».

import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';
import { cartellaDellaProva, BOLLETTA_MARZO } from '../../helpers/documentiFinti.mjs';

const RICHIESTA = 'Mi serve la bolletta della luce di marzo. Dov\'è?';
const testo = (messaggi) => (messaggi || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

test('r1 per la bolletta della luce di marzo il modello non riceve la busta paga né la lettera di dimissioni', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Necessari');
  cartellaDellaProva(dir);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'd1', name: 'CERCA_DOCUMENTI', arguments: JSON.stringify({ cosa: RICHIESTA }) }] },
      { text: `È ${BOLLETTA_MARZO}: la bolletta dell'energia elettrica di marzo.` },
    ]);
    const page = await home(app);
    await chiedi(page, RICHIESTA);
    await expect(page.locator('.dash-bubble-actions .dash-file-btn')).toHaveCount(1, { timeout: 20_000 });
    const esito = testo((await chiamateAlModello(app))[1]);
    expect(esito, 'il candidato giusto c\'è').toContain(BOLLETTA_MARZO);
    expect(esito, 'lo stipendio non serve a trovare una bolletta').not.toContain('Retribuzione netta');
    expect(esito, 'le dimissioni non servono a trovare una bolletta').not.toContain('dimissioni');
  } finally {
    await ripristina(app);
    rmSync(dir, { recursive: true, force: true });
  }
});
