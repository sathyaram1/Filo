// #2188 giro 1, rilievo 1: un file letto nella cartella della sessione e modificato nel clone è «letto in un'altra
// cartella» anche quando sta nella radice del repo (CLAUDE.md, package.json): la misura non lo mette fra i «mai letto».

import { test, expect } from '@playwright/test';
import { analizzaRighe, notaRifiuti } from '../../../scripts/session-report.mjs';

const RIFIUTO = '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>';

function righeDi(lettura, modifica) {
  let n = 0;
  const uso = (nome, input) => {
    n += 1;
    return [
      { type: 'assistant', timestamp: `2026-11-11T10:00:${String(n * 2).padStart(2, '0')}Z`, message: { id: `m${n}`, model: 'claude-opus-4-1', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: `t${n}`, name: nome, input }] } },
      { type: 'user', timestamp: `2026-11-11T10:00:${String(n * 2 + 1).padStart(2, '0')}Z`, message: { content: [{ type: 'tool_result', tool_use_id: `t${n}`, ...(nome === 'Edit' ? { is_error: true, content: RIFIUTO } : { content: 'ok' }) }] } },
    ];
  };
  return [...uso('Read', { file_path: lettura }), ...uso('Edit', { file_path: modifica, old_string: 'a', new_string: 'b' })].map((r) => JSON.stringify(r));
}

for (const nome of ['CLAUDE.md', 'package.json']) {
  test(`r1 ${nome} letto nella sessione e modificato nel clone conta come letto in un'altra cartella`, async () => {
    const rep = await analizzaRighe(righeDi(`/home/user/Filo/${nome}`, `/tmp/filo-lavori/1/${nome}`), { role: 'verifier' });
    expect(rep.rifiutiScrittura.nonLetto.altraCartella).toBe(1);
    expect(rep.rifiutiScrittura.nonLetto.mai).toBe(0);
    expect(notaRifiuti(rep.rifiutiScrittura)).toContain("letto in un'altra cartella 1");
  });
}

test('un file in una sottocartella letto nella sessione resta riconosciuto', async () => {
  const rep = await analizzaRighe(righeDi('/home/user/Filo/src/main/a.js', '/tmp/filo-lavori/1/src/main/a.js'), { role: 'verifier' });
  expect(rep.rifiutiScrittura.nonLetto.altraCartella).toBe(1);
});
