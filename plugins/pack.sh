#!/usr/bin/env bash
#
# Packs a plugin into the zip the marketplace takes, from a POSIX shell.
#
#     plugins/pack.sh            # every plugin
#     plugins/pack.sh github     # one, or several
#
# There is no Node on the development machine, so this is a wrapper around the
# container the rest of the toolchain runs in — `pack.mjs` is the actual
# packer, and `plugins/README.md` says what it puts in a zip.
#
# Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Run from the repository root whatever directory this was called from:
# compose resolves its services relative to its own file.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec docker compose run --rm dev npm run pack --workspace @orknux/plugins -- "$@"
