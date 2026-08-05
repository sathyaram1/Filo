import { _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ROOT = '/home/user/Filo/.claude/worktrees/worker-70a50a5a';
const userData = mkdtempSync(join(tmpdir(), 'filo-dbg-'));
writeFileSync(join(userData, 'storage.json'), JSON.stringify({
  filo_notes: [
    { id: 'n3', ts: '2026-01-03T10:00:00.000Z', text: 'MIGRA_terzo', context: 'salute' },
    { id: 'n1', ts: '2026-01-01T10:00:00.000Z', text: 'MIGRA_primo', context: 'spesa' },
  ],
}), 'utf8');

const app = await electron.launch({
  args: ['.'], cwd: APP_ROOT,
  env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
});

const state = await app.evaluate(async () => {
  const out = {};
  out.hasNotes = !!globalThis.SN_EDITOR_NOTES;
  out.hasStore = !!globalThis.SN_EDITOR_STORE;
  out.hasMem = !!globalThis.SN_FILO_MEMORY;
  try {
    const r = await chrome.storage.local.get(['filo_notes', 'filo.editor.collection', 'filo.editor.notesMigrated', 'filo.editor.notesPointer']);
    out.filo_notes = r['filo_notes'];
    out.migrated = r['filo.editor.notesMigrated'];
    out.pointer = r['filo.editor.notesPointer'];
    const c = r['filo.editor.collection'];
    out.collection = c ? { n: (c.files || []).length, titles: (c.files || []).map((f) => f.meta && f.meta.title) } : null;
  } catch (e) { out.err = String(e); }
  // ritenta la migrazione a mano per vedere cosa ritorna
  try {
    out.retry = await require('./services/editorFiles').migrateNotesToEditor();
  } catch (e) { out.retryErr = String(e && e.stack || e); }
  return out;
});
console.log(JSON.stringify(state, null, 2));

await app.close();
rmSync(userData, { recursive: true, force: true });
