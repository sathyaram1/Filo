// Verifica #591, giro 12 — ogni controllo nella finestra nascosta si fabbrica una memoria di navigazione isolata
// con un nome che non si ripete, e quella memoria resta registrata finché Filo resta aperto: la finestra ha un tetto,
// la sua memoria no. Niente Electron: il detonatore è quello vero, Electron è finto e conta le memorie create.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
const { createDetonator } = require_(join(REPO, 'src/main/services/safebrowse/sandbox.js'));

function electronFinto() {
  const memorie = new Set();
  class BrowserWindow {
    constructor() {
      const ascolti = {};
      this.distrutta = false;
      this.webContents = {
        on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        loadURL: () => {
          setTimeout(() => (ascolti['did-stop-loading'] || []).forEach((f) => f({})), 1);
          return Promise.resolve();
        },
      };
    }
    isDestroyed() { return this.distrutta; }
    destroy() { this.distrutta = true; }
  }
  const session = {
    fromPartition: (nome) => { memorie.add(nome); return { on() {}, clearStorageData: async () => {} }; },
  };
  return { electron: { BrowserWindow, session }, memorie };
}

test('dodici controlli di fila non lasciano dodici memorie isolate registrate', async () => {
  const f = electronFinto();
  const D = createDetonator({ electron: f.electron, maxConcurrent: 2, loadTimeoutMs: 50, maxLifetimeMs: 100 });
  for (let i = 0; i < 12; i++) {
    const r = await D.detonate(`http://sospetto-${i}.esempio-giro12.xyz/`);
    expect(r && r.verdict).toBe('clean');
  }
  expect(f.memorie.size, 'le memorie create non devono crescere con i controlli: al più una per finestra viva').toBeLessThanOrEqual(2);
});
