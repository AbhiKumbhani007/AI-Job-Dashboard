#!/bin/sh
# Builds and registers ~/Applications/DossierClaude.app, the helper behind Dossier's "Open in Claude Code"
# button (New application): it handles dossier-claude:// links by opening Terminal and starting Claude Code
# with the posting's prompt, in the folder this repository is in. macOS only. Run it again after changing DossierClaude.applescript.
#
#   scripts/macos/install-claude-launcher.sh
#   scripts/macos/install-claude-launcher.sh --uninstall
set -eu

if [ "$(uname)" != "Darwin" ]; then
  echo "The launcher is for macOS." >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
app="$HOME/Applications/DossierClaude.app"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [ "${1:-}" = "--uninstall" ]; then
  [ -d "$app" ] && "$lsregister" -u "$app" && rm -rf "$app"
  echo "Removed $app"
  exit 0
fi

# The launcher starts Claude Code in this repository's folder, wherever it was cloned.
repo="$(cd "$here/../.." && pwd)"
case "$repo" in
  *'"'* | *'\\'* | *'|'* | *'&'*)
    echo "The folder $repo has a character the launcher can't hold (a quote, backslash, | or &). Move the repository." >&2
    exit 1
    ;;
esac

mkdir -p "$HOME/Applications"
rm -rf "$app"
build="$(mktemp -d)"
sed "s|__DOSSIER_FOLDER__|$repo|" "$here/DossierClaude.applescript" > "$build/DossierClaude.applescript"
osacompile -o "$app" "$build/DossierClaude.applescript"
rm -rf "${build:?}"

# Claim the dossier-claude:// scheme, run without a Dock icon, and say why it asks to control Terminal.
plist="$app/Contents/Info.plist"
edit() { /usr/libexec/PlistBuddy "$@" "$plist"; }
edit -c "Delete :CFBundleURLTypes" 2>/dev/null || true
edit -c "Add :CFBundleURLTypes array" \
  -c "Add :CFBundleURLTypes:0 dict" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLName string Dossier Claude launcher" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
  -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string dossier-claude"
edit -c "Set :CFBundleIdentifier local.dossier.claude-launcher" 2>/dev/null ||
  edit -c "Add :CFBundleIdentifier string local.dossier.claude-launcher"
edit -c "Delete :LSUIElement" 2>/dev/null || true
edit -c "Add :LSUIElement bool true"
edit -c "Delete :NSAppleEventsUsageDescription" 2>/dev/null || true
edit -c "Add :NSAppleEventsUsageDescription string DossierClaude opens Terminal to start Claude Code."

# Editing the plist broke the signature osacompile made; Apple silicon won't run an app with a bad one.
codesign --force --deep --sign - "$app"
"$lsregister" -f "$app"

echo "Installed $app"
echo "The first time you use it, macOS asks whether DossierClaude may control Terminal: choose OK."
echo "Brave or Chrome also asks once whether dossier-claude links may open this app: tick \"always allow\"."
