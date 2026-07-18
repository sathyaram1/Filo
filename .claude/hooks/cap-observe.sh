#!/bin/bash
# cap-observe.sh — DIAGNOSTIC hook (step 1 of the dynamic session-limit gate).
#
# Goal: learn, from ground truth, whether the plan's 5-hour session limit reaches
# a hook at all, and under which signature. The docs do NOT document how the 5h
# limit surfaces (error_type "rate_limit"/"unknown"/…? which stop_reason for a
# cut subagent?), so we must MEASURE it before designing any spawn threshold.
#
# Wiring (see .claude/settings.local.json):
#   - StopFailure  → fires when the MAIN turn ends on an API error (incl. a
#                    rate/usage-limit kill of the orchestrator itself). Carries
#                    error_type + error_message.
#   - SubagentStop → fires when a WORKER ends, success OR error, while the
#                    orchestrator is still alive. Carries stop_reason.
#   Stop is deliberately NOT wired: per the docs it does NOT fire on API errors,
#   so it is useless for capturing a cut.
#
# Design constraints (mirrors auto-commit-merge.sh philosophy):
#   - Never fails the session: always exits 0, all git ops best-effort.
#   - Silent in normal use: records only "failure-shaped" events (any
#     StopFailure, or a SubagentStop whose stop_reason is NOT a clean end), so
#     ordinary local sessions with clean subagent completions stay quiet.
#   - Persists to git: the ephemeral cloud container is reclaimed after the run,
#     so only a committed+pushed file survives to the next routine.
#
# It records the EVENT + its signature, not the usage cost: reading ccusage in a
# possibly-dying container is slow/unreliable. The cost is captured separately by
# the orchestrator's high-water checkpoint (cap-state.json), correlated by time.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

INPUT=$(cat)

# One node pass: parse stdin, apply the re-entrancy guard + noise filter, and
# emit the JSONL observation line — or emit nothing, in which case we exit.
LINE=$(printf '%s' "$INPUT" | TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j={};try{j=JSON.parse(s)}catch{}
  if (j.stop_hook_active) return;                       // re-entrancy guard
  const ev=j.hook_event_name||"";
  const sr=j.stop_reason||"";
  if (ev==="Stop") return;                              // clean main stop: ignore
  if (ev==="SubagentStop" && ["end_turn","stop_sequence","max_tokens"].includes(sr)) return; // clean worker end: ignore
  const out={ ts:process.env.TS, event:ev,
    error_type:j.error_type||null,
    error_message:(j.error_message||"").slice(0,200)||null,
    stop_reason:sr||null, agent_type:j.agent_type||null };
  process.stdout.write(JSON.stringify(out));
})' 2>/dev/null)

[ -z "$LINE" ] && exit 0

OBS="feedback-triage/cap-observations.jsonl"
printf '%s\n' "$LINE" >> "$OBS"
git add "$OBS" 2>/dev/null
git -c user.email=claude@local -c user.name=claude-local commit -q -m "cap-observe: session-limit diagnostic" -- "$OBS" 2>/dev/null
git push origin HEAD >/dev/null 2>&1 || true
exit 0
