#!/usr/bin/env pwsh
#
# Packs a plugin into the zip the marketplace takes, from PowerShell.
#
#     .\plugins\pack.ps1            # every plugin
#     .\plugins\pack.ps1 github     # one, or several
#
# There is no Node on the development machine, so this is a wrapper around the
# container the rest of the toolchain runs in — `pack.mjs` is the actual
# packer, and `plugins/README.md` says what it puts in a zip.
#
# Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

$ErrorActionPreference = 'Stop'

# Run from the repository root whatever directory this was called from:
# compose resolves its services relative to its own file.
Push-Location (Join-Path $PSScriptRoot '..')
try {
    docker compose run --rm dev npm run pack --workspace '@orknux/plugins' -- @args
    # A container that failed is this script failing; PowerShell would
    # otherwise carry on and report success.
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
