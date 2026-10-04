// #873 giro 4, rilievo 1 — Wi-Fi staccato su un computer con un adattatore virtuale sempre acceso (Docker, WSL2,
// macchine virtuali): Chromium continua a dire «online», ma non c'è più nessuna strada verso fuori. La voce della rete
// deve dire «offline», e la chat pure; oggi dice «Collegato».
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

const require = createRequire(import.meta.url);

test('Linux: nessuna rotta verso fuori, solo il ponte di Docker acceso: la rete è offline', async () => {
  const radice = fs.mkdtempSync(path.join(os.tmpdir(), 'filo-873-g4-'));
  fs.mkdirSync(path.join(radice, 'proc', 'net'), { recursive: true });
  fs.mkdirSync(path.join(radice, 'sys', 'class', 'net', 'docker0'), { recursive: true });
  // Solo la rete interna del ponte: la rotta predefinita è sparita con il Wi-Fi.
  fs.writeFileSync(path.join(radice, 'proc', 'net', 'route'),
    'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n'
    + 'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n');
  fs.writeFileSync(path.join(radice, 'proc', 'net', 'ipv6_route'), '');

  const Stato = require('../../../src/main/services/statoSistema.js');
  require('../../../src/shared/sistema.js');
  const S = globalThis.SN_SISTEMA;
  const parti = await Stato.leggiLinux(radice, async () => null);
  // Chromium conta il ponte acceso e dice online.
  const stato = Stato.componi(parti, true);

  expect(S.descrivi(stato).rete && S.descrivi(stato).rete.testo).toBe('offline');
  expect(S.righePrompt(stato).righe.join('\n')).toContain('Rete: OFFLINE');
  fs.rmSync(radice, { recursive: true, force: true });
});
