#!/bin/bash
# cap-observe.sh — DIAGNOSTIC hook (step 1 of the dynamic session-limit gate).
#
# Wired to StopFailure ONLY (see .claude/settings.local.json). StopFailure fires
# when a turn ends on an API error — including the plan's rate/usage-limit kill —
# and carries error_type + error_message. Being error-only by nature, it stays
# SILENT during normal operation: no per-turn noise, the routine runs exactly as
# before, and the hook speaks up only on an actual failure.
#
# Why NOT SubagentStop: we wired it too at first and observed (2026-07-18) that in
# this harness SubagentStop fires with stop_reason=null on EVERY subagent end,
# clean or not — so it cannot tell a cut worker from a normal completion and would
# commit an observation on every worker. Dropped to keep normal runs quiet. A cut
# worker is still caught: the orchestrator's own next call hits the limit →
# StopFailure, and the next routine's startup bonifica finds the orphan claim /
# half-written state. (If SubagentStop is ever re-wired, the script below only
# records a clearly failure-shaped one — explicit error field or a limit marker
# in the text — never a clean end.)
#
# Why NOT Stop: per the docs, Stop does NOT fire on API errors.
#
# Records the EVENT + its signature, not the usage cost (reading ccusage in a
# possibly-dying container is unreliable); the cost is correlated from the
# orchestrator's high-water checkpoint. Best-effort, never fails the session
# (always exit 0). Committed+pushed so it survives the ephemeral cloud container
# (only git persists across routine runs).

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

INPUT=$(cat)

# One node pass: parse stdin, apply the re-entrancy guard + failure filter, and
# emit the JSONL observation line — or emit nothing, in which case we exit.
LINE=$(printf '%s' "$INPUT" | TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j={};try{j=JSON.parse(s)}catch{}
  if (j.stop_hook_active) return;                 // re-entrancy guard
  const ev=j.hook_event_name||"";
  if (ev==="Stop") return;                        // never fires on error; ignore if it does
  if (ev==="SubagentStop") {                      // not wired; record only if truly failure-shaped
    const blob=((j.error_type||"")+" "+(j.error_message||"")+" "+(j.last_assistant_message||"")).toLowerCase();
    const looksCut=/session limit|usage limit|rate.?limit|out of .*credit|quota/.test(blob);
    if (!j.error_type && !looksCut) return;
  }
  const out={ ts:process.env.TS, event:ev,
    error_type:j.error_type||null,
    error_message:(j.error_message||"").slice(0,300)||null,
    stop_reason:j.stop_reason||null,
    agent_type:j.agent_type||null,
    last_msg:(j.last_assistant_message||"").slice(0,120)||null };
  process.stdout.write(JSON.stringify(out));
})' 2>/dev/null)

[ -z "$LINE" ] && exit 0

# NOTA: prima scriveva in feedback-triage/ (la coda su git, smontata con la
# spec ROUTINE-AUTH-SPEC.md); il diagnostico resta su git perché è l'unica cosa
# che sopravvive al container effimero, ma vive in .claude/, non nella coda.
OBS=".claude/cap-observations.jsonl"
printf '%s\n' "$LINE" >> "$OBS"
git add "$OBS" 2>/dev/null
git -c user.email=claude@local -c user.name=claude-local commit -q -m "cap-observe: session-limit diagnostic" -- "$OBS" 2>/dev/null
git push origin HEAD >/dev/null 2>&1 || true
exit 0
