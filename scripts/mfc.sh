#!/usr/bin/env bash
# Wrapper so `scripts/mfc.sh <cmd>` works from the repo root without
# touching PYTHONPATH manually.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONPATH="${SCRIPT_DIR}${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m mfc "$@"
