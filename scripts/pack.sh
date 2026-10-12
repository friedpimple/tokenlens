#!/usr/bin/env bash
# Builds the Chrome, Firefox and source archives into dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build.js
