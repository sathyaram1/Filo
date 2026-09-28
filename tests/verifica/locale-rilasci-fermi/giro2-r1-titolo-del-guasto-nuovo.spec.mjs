// Giro 2, rilievo 1: con un guasto vecchio ancora rosso, il feedback nuovo porta nel titolo il guasto NUOVO, non i
// file che hanno già un feedback aperto. Server finto con la semantica delle chiavi di buildAlarm: il titolo è quello spedito.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ALLARME = fileURLToPath(new URL('../../../scripts/build-alarm.mjs', import.meta.url));

function fintoServer() {
  const aperti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const j = JSON.parse(b || '{}');
      const keys = Array.isArray(j.keys) ? j.keys : [];
      const coperte = keys.filter((k) => aperti.some((f) => f.alarmKeys.includes(k)));
      const nuove = keys.filter((k) => !coperte.includes(k));
      res.setHeader('Content-Type', 'application/json');
      if (keys.length && !nuove.length) {
        res.end(JSON.stringify({ ok: true, duplicate: true, num: aperti[0]?.num, nuove: [], coperte }));
        return;
      }
      const num = `#${aperti.length + 1}`;
      aperti.push({ num, titolo: String(j.name || ''), alarmKeys: nuove });
      res.end(JSON.stringify({ ok: true, duplicate: false, num, nuove, coperte }));
    });
  });
  return { srv, aperti };
}

const avvia = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));

const allarme = (porta, argomenti, cwd) => new Promise((ok) => {
  execFile(process.execPath, [ALLARME, ...argomenti], {
    cwd,
    env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${porta}`, FILO_BUILD_PASSPHRASE: 'finta' },
  }, (err, stdout, stderr) => ok({ codice: err ? err.code : 0, stdout, stderr }));
});

test('suite: il secondo feedback nomina il file rotto dopo, non quello che ha già il suo feedback', async () => {
  const dir = cartellaTemporanea('giro2-r1-suite');
  const { srv, aperti } = fintoServer();
  const porta = await avvia(srv);
  try {
    const titolo = 'Suite Playwright rossa su main: commit non pubblicabile';
    writeFileSync(join(dir, 'prima.txt'), 'suite:tests/wallet-credits.spec.mjs\nsuite:fuori-dai-casi\n');
    await allarme(porta, [titolo, 'testo', '--chiavi-da', join(dir, 'prima.txt')], dir);
    // Il guasto di prima è ancora rosso; si rompe anche editor-salva.
    writeFileSync(join(dir, 'dopo.txt'),
      'suite:tests/editor-salva.spec.mjs\nsuite:tests/wallet-credits.spec.mjs\nsuite:fuori-dai-casi\n');
    await allarme(porta, [titolo, 'testo', '--chiavi-da', join(dir, 'dopo.txt')], dir);

    expect(aperti.length, 'il guasto nuovo apre il suo feedback').toBe(2);
    const nuovo = aperti[1];
    expect(nuovo.alarmKeys).toEqual(['suite:tests/editor-salva.spec.mjs']);
    expect(nuovo.titolo).toContain('editor-salva');
    expect(nuovo.titolo, 'wallet-credits ha già il feedback #1').not.toContain('wallet-credits');
    expect(nuovo.titolo, 'gli errori fuori dai casi hanno già il feedback #1').not.toContain('fuori dai casi');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancello unit: con undici file rossi da giorni, il feedback del dodicesimo lo nomina', async () => {
  const dir = cartellaTemporanea('giro2-r1-unit');
  const { srv, aperti } = fintoServer();
  const porta = await avvia(srv);
  try {
    const titolo = 'Controlli automatici rossi: nessuna versione pubblicata';
    const vecchi = ['commentiRegola', 'fineRigaLf', 'macSupport', 'linuxSupport', 'terminaleCodifica',
      'proveDeiGiri', 'releaseSuite', 'shortcutsMac', 'istanti', 'percorsiTemporanei', 'verifyLocalProveGiro'];
    const riga = (n) => `not ok 1 - x\n  location: '${join(dir, 'tests', 'unit', `${n}.test.mjs`)}:3:1'\n`;
    writeFileSync(join(dir, 'unit-1.log'), vecchi.map(riga).join(''));
    await allarme(porta, [titolo, 'testo', '--chiavi-unit', join(dir, 'unit-1.log')], dir);
    const conNuovo = [...vecchi.slice(0, 9), 'walletCrediti', ...vecchi.slice(9)];
    writeFileSync(join(dir, 'unit-2.log'), conNuovo.map(riga).join(''));
    await allarme(porta, [titolo, 'testo', '--chiavi-unit', join(dir, 'unit-2.log')], dir);

    expect(aperti.length).toBe(2);
    expect(aperti[1].alarmKeys).toEqual(['unit:tests/unit/walletCrediti.test.mjs']);
    expect(aperti[1].titolo, 'il titolo del feedback nuovo deve dire quale file è rotto').toContain('walletCrediti');
    expect(aperti[1].titolo).not.toContain('fineRigaLf');
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
