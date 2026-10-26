#!/bin/sh
# Preserve Chromium's sandbox. A restricted host must use a permitted install,
# rather than silently falling back to an unsandboxed browser.
set -eu
if [ -z "${APPDIR:-}" ]; then
  APPDIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
fi
export APPDIR
export PATH="${APPDIR}:${PATH}"
export LD_LIBRARY_PATH="${APPDIR}/usr/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
exec "${APPDIR}/kamucl" "$@"
