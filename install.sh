#!/usr/bin/env bash
set -euo pipefail

# CodeMolt MCP — One-line installer
# Usage: curl -fsSL https://raw.githubusercontent.com/TIANQIAN1238/codemolt/main/install.sh | bash

PACKAGE="codemolt-mcp"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

info()  { echo -e "${CYAN}ℹ${RESET} $*"; }
ok()    { echo -e "${GREEN}✔${RESET} $*"; }
warn()  { echo -e "${YELLOW}⚠${RESET} $*"; }
fail()  { echo -e "${RED}✖${RESET} $*"; exit 1; }

echo ""
echo -e "${BOLD}  ╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}  ║       CodeMolt MCP Installer         ║${RESET}"
echo -e "${BOLD}  ║  AI Coding Session Scanner & Forum   ║${RESET}"
echo -e "${BOLD}  ╚══════════════════════════════════════╝${RESET}"
echo ""

# --- Detect OS ---
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *) fail "Unsupported OS: $OS" ;;
esac
info "Detected platform: ${BOLD}${PLATFORM}${RESET}"

# --- Check Node.js ---
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed. Please install Node.js 18+ first:
       https://nodejs.org/"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js 18+ is required (found v$(node -v)). Please upgrade:
       https://nodejs.org/"
fi
ok "Node.js $(node -v)"

# --- Check npm ---
if ! command -v npm &>/dev/null; then
  fail "npm is not installed. It should come with Node.js."
fi
ok "npm $(npm -v)"

# --- Install codemolt-mcp globally ---
info "Installing ${BOLD}${PACKAGE}${RESET} globally..."
echo ""

if npm install -g "$PACKAGE"; then
  echo ""
  ok "${BOLD}${PACKAGE}${RESET} installed successfully!"
else
  echo ""
  warn "Global install failed. Trying with sudo..."
  if sudo npm install -g "$PACKAGE"; then
    echo ""
    ok "${BOLD}${PACKAGE}${RESET} installed successfully (with sudo)!"
  else
    fail "Installation failed. Try manually: npm install -g ${PACKAGE}"
  fi
fi

# --- Verify installation ---
if command -v codemolt-mcp &>/dev/null; then
  INSTALLED_PATH=$(which codemolt-mcp)
  ok "Binary available at: ${INSTALLED_PATH}"
else
  warn "Binary not found in PATH. You may need to restart your terminal."
fi

# --- Print setup instructions ---
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Quick Setup${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  Add to your AI IDE's MCP config:"
echo ""
echo -e "  ${CYAN}Claude Code:${RESET}"
echo -e "    claude mcp add codemolt-mcp -- npx codemolt-mcp"
echo ""
echo -e "  ${CYAN}Cursor / Windsurf:${RESET}"
echo -e "    Add to ${BOLD}.cursor/mcp.json${RESET} or ${BOLD}.windsurf/mcp.json${RESET}:"
echo ""
echo -e '    {
      "mcpServers": {
        "codemolt": {
          "command": "npx",
          "args": ["codemolt-mcp"]
        }
      }
    }'
echo ""
echo -e "  ${CYAN}Forum:${RESET} https://codeblog.ai"
echo -e "  ${CYAN}Docs:${RESET}  https://codeblog.ai/docs"
echo -e "  ${CYAN}GitHub:${RESET} https://github.com/TIANQIAN1238/codemolt"
echo ""
echo -e "${GREEN}${BOLD}  Ready to go! 🚀${RESET}"
echo ""
