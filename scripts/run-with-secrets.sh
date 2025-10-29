#!/usr/bin/env bash
set -euo pipefail

# Wrapper to run with injected secrets (forwards args to app)
# Retrieves from secret-tool (libsecret/GNOME Keyring)
# if service "prss" key "OpenrouterApiKey" exists, uses it as OPENROUTER_API_KEY
# else if service "prss" key "OpenAIApiKey" exists, uses
# OPENROUTER_API_KEY="$(secret-tool lookup service prss key OpenrouterApiKey || true)"
# OPENAI_API_KEY="$(secret-tool lookup service prss key OpenAIApiKey || true)"

# Try to get API keys from secret-tool user attributes only
OPENROUTER_API_KEY="$(secret-tool lookup key OpenrouterApiKey || true)"
OPENAI_API_KEY="$(secret-tool lookup key OpenAIApiKey || true)"

if [ -n "$OPENROUTER_API_KEY" ]; then
  export OPENROUTER_API_KEY
  echo "Using OPENROUTER_API_KEY from secret-tool (service: prss)"
elif [ -n "$OPENAI_API_KEY" ]; then
  export OPENAI_API_KEY
  echo "Using OPENAI_API_KEY from secret-tool (fallback mode)"
else
  echo "Error: No API key found in secret-tool (service: prss). Store with: secret-tool store --label='PRSS API' service prss key OpenrouterApiKey" >&2
  exit 1
fi

# Forward all args to the app (e.g., folder, --lenses, etc.)
echo "Starting PRRS with args: $@"
exec pnpm run run-app "$@"
