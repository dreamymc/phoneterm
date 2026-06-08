#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
node server/index.js
