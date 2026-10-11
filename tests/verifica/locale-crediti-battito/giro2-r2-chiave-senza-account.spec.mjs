// Giro 2, rilievo 2: una parola d'ordine di routine creata oggi nasce senza account, e il suo consumo resta fuori
// dalla riserva. Lo strumento dell'owner, alla creazione, deve chiederlo o almeno dire come darglielo.
// Il server è finto: un fetch caricato prima dello script risponde al token e a routineKeys, senza rete.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const FINTO = `
import { appendFileSync } from 'node:fs';
const log = process.env.FINTO_LOG;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.includes('routineKeys')) return new Response(JSON.stringify({ id_token: 'idt', expires_in: '3600', user_id: 'u' }), { status: 200 });
  const d = JSON.parse(String((init && init.body) || '{}')).data || {};
  appendFileSync(log, JSON.stringify(d) + '\\n');
  if (d.op === 'issue') return new Response(JSON.stringify({ result: { ok: true, slug: d.slug, scope: d.scope, passphrase: 'parola-finta' } }), { status: 200 });
  return new Response(JSON.stringify({ result: { ok: true, keys: [] } }), { status: 200 });
};
`;

test('r2 creare una parola d\'ordine di routine chiede l\'account o dice come darglielo', () => {
  const dir = cartellaTemporanea('chiave-account-');
  try {
    const finto = join(dir, 'finto.mjs');
    const log = join(dir, 'chiamate.log');
    writeFileSync(finto, FINTO);
    const r = spawnSync(process.execPath, [`--import=${pathToFileURL(finto).href}`, resolve(ROOT, 'scripts', 'routine-keys.mjs'), 'crea', 'routine-nuova', 'routine', 'macchina nuova'], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, FILO_ADMIN_REFRESH_TOKEN: 'finto', FINTO_LOG: log },
    });
    const chiamate = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const testo = `${r.stdout}\n${r.stderr}`;
    const conAccount = chiamate.some((c) => c.account === 'A' || c.account === 'B');
    const ricordato = /account/i.test(testo);
    expect(conAccount || ricordato, `uscita: ${testo}\nchiamate: ${JSON.stringify(chiamate)}`).toBe(true);
  } finally {
    togliCartella(dir);
  }
});
