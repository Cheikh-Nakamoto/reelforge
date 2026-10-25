#!/usr/bin/env bash
# Runs a studio project's tickets headless: one fresh `claude -p` session per ticket, so no session grows with the
# whole edit (decision 22; the subagent loop is the MCP prompt `tickets`). On a checkpoint, a first session prepares
# the question, the terminal asks it, and a second session applies the answer. Stops on a ticket left `ouvert`.
#
#   scripts/ticket-loop.sh <projet>
#
# TICKET_LOOP_CLAUDE_ARGS adds flags to every session (e.g. "--model sonnet" or "--disallowedTools Edit Write").
# An empty answer, or end of input (Ctrl-D), at a checkpoint stops the loop and leaves the ticket open.
set -euo pipefail

project=${1:?usage: scripts/ticket-loop.sh <projet>}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root" # .mcp.json starts the studio server from the repo root

studio() { npx --no-install tsx src/cli.ts "$@"; }

# Unattended: `auto` decides what it can, anything that would still prompt is denied rather than waited on.
read -r -a extra <<<"${TICKET_LOOP_CLAUDE_ARGS:-}"
session() { # <id> <system prompt addition>
  claude -p "/mcp__studio__ticket $project $1" --permission-mode auto --permission-prompts none \
    --append-system-prompt "$2" "${extra[@]}" </dev/null
}

headless="Tu tournes dans scripts/ticket-loop.sh (claude -p) : personne ne lit tes questions pendant la session."

field() { sed -n "/^---$/,/^---$/s/^$1: //p" <<<"$2" | head -n1; }

while :; do
  next=$(studio tickets "$project" --next)
  if [[ $next != ---* ]]; then
    echo "$next"
    exit 0
  fi
  id=$(field id "$next")
  checkpoint=$(field checkpoint "$next")
  echo "== $id $(sed -n 's/^# //p' <<<"$next" | head -n1)"

  if [[ -z $checkpoint ]]; then
    out=$(session "$id" "$headless")
  else
    question=$(session "$id" "$headless Ce ticket est un checkpoint ($checkpoint) : prépare la porte (ce que \
l'utilisateur doit juger et où regarder) et rends seulement la question, commençant par « QUESTION ». Le ticket reste \
ouvert ; n'applique aucune réponse.")
    echo "$question"
    if [[ $question != *QUESTION* ]]; then
      echo "== $id : la préparation n'a pas rendu de question, boucle arrêtée."
      exit 1
    fi
    if ! read -r -p "Réponse > " answer || [[ -z $answer ]]; then
      echo
      echo "== $id : pas de réponse, boucle arrêtée (le ticket reste ouvert)."
      exit 1
    fi
    out=$(session "$id" "$headless Checkpoint $id : l'utilisateur a répondu « $answer ». Applique cette réponse, \
puis ferme le ticket.")
  fi
  echo "$out"

  after=$(studio tickets "$project" --next)
  if [[ $out == BLOQUÉ* ]] || { [[ $after == ---* ]] && [[ $(field id "$after") == "$id" ]]; }; then
    echo "== $id reste ouvert : boucle arrêtée."
    exit 1
  fi
done
