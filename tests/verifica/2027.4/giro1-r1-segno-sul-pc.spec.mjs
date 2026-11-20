// Verifica #2027.4 giro 1: il segno riservato che il server non ha ricevuto (server giù al momento della lettura) deve
// seguire il feedback scritto dopo, come fa lo sporco rimasto sul PC. Server finto: nessuna chiamata vera.
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import * as B from '../../../scripts/lib/biglietto-locale.mjs';
import * as SCRIPT from '../../../scripts/claude-feedback.mjs';

const SEGRETO = 's'.repeat(43);

function server({ giu = false } = {}) {
  const fetchImpl = async (url, init) => {
    const { data } = JSON.parse(init.body);
    if (giu) throw new TypeError('fetch failed');
    // Il server non ha ricevuto il segno: per lui il biglietto è pulito e non riservato.
    const result = data.op === 'stato' ? { ok: true, fiducia: 'fidato', chiuso: false, riservato: false } : { ok: true };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto' };
}

test('r1 letto un dato privato col server giù, il feedback scritto dopo nasce riservato', async () => {
  const dir = cartellaTemporanea('segno-pc-');
  try {
    const p = join(dir, '.claude', 'biglietti', 'sessione.json');
    B.scriviFile(p, { ticket: SEGRETO, fp: 'f'.repeat(64), natoIl: 1 });
    const env = { FILO_BIGLIETTO_FILE: p };
    const r = await B.segnaRiservato('letto #813', { env, cwd: dir, deps: server({ giu: true }) });
    expect(r.segnati).toBe(0);
    const b = await B.trovaBiglietto({ env, cwd: dir, deps: server() });
    const campi = SCRIPT.campiDelBiglietto(b);
    // Nasce riservato solo se dichiara il segno: il biglietto sul server non ce l'ha.
    expect(campi.riservatoDichiarato).toBe(true);
  } finally {
    togliCartella(dir);
  }
});
