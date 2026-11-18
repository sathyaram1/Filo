// Verifica #2536, giro 1: intervista rifatta con la memoria piena, l'utente dice solo nome, uso del pc e «dammi del tu».
// Il modello vero (prompt e strumenti del ramo) non deve citare, attribuirgli o riscrivere in memoria quello che sa
// solo dalla MEMORIA. Chiamate vere a OpenRouter: senza chiave la prova si salta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
for (const m of ['onboarding.js', 'capabilities.js', 'constants.js', 'actionLevels.js', 'actionTools.js']) require(join(ROOT, 'src', 'shared', m));
const O = globalThis.SN_ONBOARDING;
const C = globalThis.SN_CONST;
const TOOLS = globalThis.SN_ACTION_TOOLS.definitions();

function chiave() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const f = join(ROOT, 'tests', 'agent', '.env');
  if (!existsSync(f)) return '';
  return (readFileSync(f, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m) || [])[1]?.trim() || '';
}
const KEY = chiave();

const PROFILO = '- Fa il geometra in uno studio tecnico\n- Ha un gatto che si chiama Pepe\n- Ha prenotato un volo per Lisbona a dicembre';
const PREFERENZE = '- Preferisce risposte brevi\n- Usa il tema scuro';
// Citato o attribuito nella risposta, o riscritto in memoria come se l'avesse detto oggi.
const NELLA_PROSA = /geometr|studio tecnico|\bpepe\b|gatt|lisbon|\bvolo\b|(eri|avevi|hai) già (detto|scritto)|mi hai detto|tue preferenze|nelle preferenze|mi risulta/i;
const IN_MEMORIA = /geometr|studio tecnico|\bpepe\b|gatt|lisbon|\bvolo\b/i;

function system(turni) {
  return C.PROMPTS.filoChat({
    sistema: 'win32', capacita: '', profilo: PROFILO, preferenze: PREFERENZE,
    onboarding: O.renderChecklistForPrompt(O.restart({ ...O.emptyState(), done: true })),
    onboardingTurns: turni, onboardingMax: 7, onboardingRifatta: true, adesso: 'sabato 15 novembre 2026, 10:12',
  });
}

async function una(model, sys, messages) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: sys }, ...messages], max_tokens: 4000, tools: TOOLS }),
      });
      const m = (await r.json())?.choices?.[0]?.message;
      if (m && ((m.content && m.content.trim()) || m.tool_calls?.length)) return m;
    } catch { /* si riprova */ }
    await new Promise((res) => setTimeout(res, 3000 * (t + 1)));
  }
  return null;
}

async function turno(model, sys, msgs) {
  let prosa = ''; let memoria = '';
  for (let g = 0; g < 3; g++) {
    const m = await una(model, sys, msgs);
    if (!m) throw new Error(`${model}: nessuna risposta`);
    if (m.content) prosa += `${m.content.trim()} `;
    if (!m.tool_calls?.length) { msgs.push({ role: 'assistant', content: m.content || '' }); break; }
    msgs.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      if (tc.function.name === 'memoria') memoria += `${tc.function.arguments} `;
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: 'fatto' });
    }
  }
  return { prosa, memoria };
}

async function conversazione(model) {
  const msgs = [{ role: 'assistant', content: O.WELCOME_MESSAGE }];
  msgs.push({ role: 'user', content: 'mi chiamo luca, uso il pc x lavoro sopratutto mail e excel e un po youtube la sera' });
  const t1 = await turno(model, system(1), msgs);
  msgs.push({ role: 'user', content: 'dammi del tu ovvio' });
  const t2 = await turno(model, system(2), msgs);
  const fuga = [t1, t2].map((t) => (t.prosa.match(NELLA_PROSA) || t.memoria.match(IN_MEMORIA) || [''])[0]).filter(Boolean);
  return { fuga, testo: [t1, t2].map((t) => `${t.prosa.trim()} [memoria: ${t.memoria.trim()}]`).join(' / ') };
}

test.describe.configure({ timeout: 300_000 });

for (const model of ['deepseek/deepseek-v4-flash', 'anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4.1-flash']) {
  test(`r1 ${model}: su 10 interviste rifatte al più una tira in ballo la memoria`, async () => {
    test.skip(!KEY, 'serve una chiave OpenRouter');
    const esiti = await Promise.all(Array.from({ length: 10 }, () => conversazione(model)));
    const fughe = esiti.filter((e) => e.fuga.length);
    expect(fughe.length, fughe.map((e) => `${e.fuga.join(',')}: ${e.testo}`).join('\n\n')).toBeLessThanOrEqual(1);
  });
}
