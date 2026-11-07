// #1589 giro 20, rilievo 1: chi aggiorna da una versione con la protezione delle pagine delicate accesa (il valore di
// serie di prima) non deve trovarsi posta, banca, enti pubblici e pagine con una password che mandano da sole senza
// aver scritto «conferma».

import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('r1 dopo l\'aggiornamento posta, banca, enti pubblici e pagine con una password chiedono ancora prima, come prima', async () => {
  test.setTimeout(90_000);
  const userData = cartellaTemporanea('filo-aggiorna-privacy-');
  // Le impostazioni come le lasciava la versione di prima: nessun livello, la protezione delle pagine delicate accesa.
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({
    settings: { security: { pagineDelicate: { enabled: true, siti: [], righeScartate: [] } } },
  }), 'utf8');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  try {
    await expect.poll(() => app.evaluate(() => Boolean(globalThis.SN_DELICATE && globalThis.SN_STORAGE)), { timeout: 30_000 }).toBe(true);
    const motivi = await app.evaluate(async () => {
      const D = globalThis.SN_DELICATE;
      const out = {};
      for (const [nome, url] of [['posta', 'https://mail.google.com/mail/u/0/'], ['banca', 'https://www.intesasanpaolo.com/'],
        ['enti pubblici', 'https://www.inps.it/'], ['sanità', 'https://www.miodottore.it/']]) {
        out[nome] = await D.chiede(url, { tipo: 'testo' });
      }
      return out;
    });
    expect(motivi['sanità'], 'la sanità chiede come di serie').toBeTruthy();
    expect(motivi.posta, 'la posta, protetta prima dell\'aggiornamento, manda da sola senza «conferma»').toBeTruthy();
    expect(motivi.banca, 'la banca, protetta prima dell\'aggiornamento, manda da sola senza «conferma»').toBeTruthy();
    expect(motivi['enti pubblici'], 'gli enti pubblici, protetti prima dell\'aggiornamento, mandano da soli senza «conferma»').toBeTruthy();
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
