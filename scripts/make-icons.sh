#!/bin/sh
# Render the shipped PNG icons from icons/icon.svg.
#
# Not part of the build: it needs rsvg-convert, which is not a dependency of
# anything else here, and the icons change about once a year. The PNGs are
# committed so that neither the build nor a contributor needs the tool.
#
#   sh scripts/make-icons.sh
set -eu
cd "$(dirname "$0")/.."
command -v rsvg-convert >/dev/null || { echo "needs rsvg-convert (librsvg)" >&2; exit 1; }

render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; echo "  $3 ($2px)"; }

cp icons/icon.svg public/favicon.svg
echo "  public/favicon.svg"
render icons/icon.svg          48  public/favicon.png
render icons/icon.svg         180  public/apple-touch-icon.png
render icons/icon.svg         192  public/icon-192.png
render icons/icon.svg         512  public/icon-512.png
render icons/icon-maskable.svg 512 public/icon-512-maskable.png
