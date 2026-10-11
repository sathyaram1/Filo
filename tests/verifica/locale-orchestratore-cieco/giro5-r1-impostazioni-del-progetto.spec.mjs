// Prova del giro 5 (verifica locale) sull'orchestratore cieco: non apre Filo, prova il gancio installato.
// Le impostazioni del progetto e quelle locali stanno dove scrive il worker e la sessione le ricarica:
// un disableAllHooks lì spegne anche il gancio delle impostazioni utente. Durante il giro vanno fermate come quelle utente.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function gancioInstallato(sessione) {
  const { installa } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'orchestratore-cieco.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'filo-cieco-'));
  try {
    const r = installa({ dir, sessione, creato: Date.now() });
    expect(r.ok).toBe(true);
    const s = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    return s.hooks.ConfigChange.at(-1).hooks[0].command;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function esegui(comando, ingresso) {
  const out = execFileSync('sh', ['-c', comando], { input: JSON.stringify(ingresso), encoding: 'utf8' });
  return out ? JSON.parse(out) : null;
}

for (const source of ['local_settings', 'project_settings']) {
  test(`r1 durante il giro un cambio di ${source} non arriva alla sessione dell'orchestratore`, async () => {
    const cmd = await gancioInstallato('sess-1');
    const o = esegui(cmd, { session_id: 'sess-1', hook_event_name: 'ConfigChange', source, file_path: '.claude/settings.local.json' });
    expect(o?.decision).toBe('block');
  });
}
