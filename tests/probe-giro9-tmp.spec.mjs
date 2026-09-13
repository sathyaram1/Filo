import { test } from './fixtures/electron.mjs';

test('audit scritture: quali messaggi non dicono forbidden a una pagina web', async ({ app }) => {
  const righe = await app.evaluate(async () => {
    const M = globalThis.SN_MSG.MSG;
    const provare = ['FILO_PAUSE_TIMER','FILO_RESUME_TIMER','FILO_STOP_TIMER_ALARM','DELETE_ARCHIVED_TABS',
      'REMOVE_ARCHIVED_TAB','REMOVE_SAVED_PAGE','CONSUME_SAVED_PAGE','SAVE_PAGE','SAVE_LINK','DELETE_CATEGORY',
      'RENAME_CATEGORY','MERGE_CATEGORIES','MOVE_PAGE_CATEGORY','DECKS_CREATE','DECKS_DELETE','DECKS_UPDATE',
      'CANCEL_AUTO_FEEDBACK','MARK_UPDATE_SEEN','QUIT_APP','CLOSE_ALL_TABS','CLEAR_HISTORY','CLEAR_CLIPBOARD_HISTORY',
      'PUSH_CLIPBOARD_ENTRY','FILO_COMPACT_MEMORY','FILO_RESTART_ONBOARDING','FILO_FORGET_LESSON','TAB_DOMINANT_COLOR',
      'RUN_TAB_TRIAGE','REORDER_TABS','SET_SAVED_PAGE_THUMB','SAVE_PATH','OPEN_URL','SHELL_ACTION'];
    const out = [];
    for (const k of provare) {
      const v = M[k];
      if (typeof v !== 'string') { out.push(`?????   ${k} (non esiste)`); continue; }
      let r;
      try { r = await globalThis.SN_HANDLE_MESSAGE({ type: v }, { url: 'https://sito-ostile.example/pagina.html' }); }
      catch (e) { r = { thrown: String(e && e.message) }; }
      const testo = JSON.stringify(r || {});
      const vietato = r && (r.error === 'forbidden' || /forbidden|vietat|riservat/i.test(testo));
      out.push(`${vietato ? 'VIETATO' : 'PASSA  '} ${k} (${v}) ${testo.slice(0, 110)}`);
    }
    return out;
  });
  console.log('\n' + righe.join('\n'));
});
