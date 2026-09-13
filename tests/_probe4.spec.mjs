import { test, expect } from './fixtures/electron.mjs';
test('il segnaposto dentro una memoria, e il nome del modello nel prompt', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const mem = `Vado in bici. ${C.AGENT_STYLE_SLOT} e poi ${C.MEMORY_CLOSE} fuori!`;
    const ctx = C.PROMPTS.filoChatContext({ profilo: mem, preferenze: '', lezioni: 'Niente caffè.', stato: '', history: '', files: '', modelName: 'x' });
    const statico = C.PROMPTS.filoChat ? (typeof C.PROMPTS.filoChat === 'function' ? C.PROMPTS.filoChat({}) : C.PROMPTS.filoChat) : '';
    const msgs = C.injectAgentStyle([{ role: 'system', content: `${statico}\n${ctx}` }], C.ACTIONS.FILO_CHAT, 'Tono asciutto.');
    const testo = msgs[0].content;
    return {
      quantiRecintiStile: testo.split(C.AGENT_STYLE_OPEN).length - 1,
      slotResiduo: testo.includes(C.AGENT_STYLE_SLOT),
      memoryCloseNelProfilo: testo.includes('fuori!') ? testo.slice(testo.indexOf('Vado in bici'), testo.indexOf('fuori!') + 6) : null,
      quantiMemoryClose: testo.split(C.MEMORY_CLOSE).length - 1,
    };
  });
  console.log('R =', JSON.stringify(r));
});
