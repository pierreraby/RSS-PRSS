#!/usr/bin/env bash
set -euo pipefail

# Wrapper to run with injected secrets (forwards args to app)
# Retrieves from secret-tool (libsecret/GNOME Keyring)
# before running, store secrets with:
# secret-tool store --label="PRSS API" service prss key OpenrouterApiKey
# for service-specific storage, or
# secret-tool store --label="Openrouter API key" key OpenrouterApiKey
# if service "prss" key "OpenrouterApiKey" exists, uses it as OPENROUTER_API_KEY :
# OPENROUTER_API_KEY="$(secret-tool lookup service prss key OpenrouterApiKey || true)"
# OPENAI_API_KEY="$(secret-tool lookup service prss key OpenAIApiKey || true)"

# else if service "prss" key not exist use user attributes keys only:
# Try to get API keys from secret-tool user attributes only
OPENROUTER_API_KEY="$(secret-tool lookup key OpenrouterApiKey || true)"
OPENAI_API_KEY="$(secret-tool lookup key OpenAIApiKey || true)"

if [ -n "$OPENROUTER_API_KEY" ]; then
  export OPENROUTER_API_KEY
  echo "Using OPENROUTER_API_KEY from secret-tool (user or service: prss)"
elif [ -n "$OPENAI_API_KEY" ]; then
  export OPENAI_API_KEY
  echo "Using OPENAI_API_KEY from secret-tool (fallback mode)"
else
  echo "Error: No API key found in secret-tool (user or service: prss). Store with: secret-tool store --label='PRSS API' service prss key OpenrouterApiKey" >&2
  exit 1
fi

# Forward all args to the app (e.g., folder, --lenses, etc.)
echo "Starting PRRS with args: $@"
exec pnpm run run-app "$@"

# alternatively export to environment variables with bash-alias (this script not needed then):
# alias ex_or='export OPENROUTER_API_KEY="$(secret-tool lookup service prss key OpenrouterApiKey || secret-tool lookup key OpenrouterApiKey || true)";
# alias unset_or="unset OPENROUTER_API_KEY";
# Same thing for fallback OPENAI_API_KEY if needed.
