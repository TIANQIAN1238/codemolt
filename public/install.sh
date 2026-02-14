#!/bin/bash
set -euo pipefail

# codeblog installer — downloads pre-compiled binary, no dependencies needed
# Usage: curl -fsSL https://codeblog.ai/install.sh | bash

INSTALL_DIR="${CODEBLOG_INSTALL_DIR:-$HOME/.codeblog/bin}"
BIN_NAME="codeblog"
NPM_REGISTRY="https://registry.npmjs.org"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "${CYAN}[codeblog]${NC} $1"; }
success() { echo -e "${GREEN}[codeblog]${NC} $1"; }
warn() { echo -e "${YELLOW}[codeblog]${NC} $1"; }
error() { echo -e "${RED}[codeblog]${NC} $1" >&2; exit 1; }

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *) error "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) error "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

get_latest_version() {
  curl -fsSL "$NPM_REGISTRY/codeblog-app/latest" 2>/dev/null | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4
}

install_binary() {
  local platform="$1"
  local pkg="codeblog-app-${platform}"

  # Get latest version
  info "Checking latest version..."
  local version
  version="$(get_latest_version)"
  if [ -z "$version" ]; then
    error "Failed to fetch latest version from npm"
  fi
  info "Latest version: $version"

  # Download tarball from npm
  info "Downloading $pkg@$version..."
  local tarball_url
  tarball_url="$NPM_REGISTRY/$pkg/-/$pkg-$version.tgz"

  local tmpdir
  tmpdir="$(mktemp -d)"
  trap "rm -rf $tmpdir" EXIT

  curl -fsSL "$tarball_url" -o "$tmpdir/pkg.tgz" || error "Failed to download binary for $platform"

  # Extract binary
  info "Installing..."
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$tmpdir/pkg.tgz" -C "$tmpdir"

  # Binary is at package/bin/codeblog
  cp "$tmpdir/package/bin/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
  chmod +x "$INSTALL_DIR/$BIN_NAME"

  success "Installed codeblog v$version to $INSTALL_DIR/$BIN_NAME"
}

setup_path() {
  if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
    return
  fi

  local shell_rc
  case "${SHELL:-/bin/bash}" in
    */zsh) shell_rc="$HOME/.zshrc" ;;
    */bash) shell_rc="$HOME/.bashrc" ;;
    *) shell_rc="$HOME/.profile" ;;
  esac

  if ! grep -q "codeblog" "$shell_rc" 2>/dev/null; then
    echo "" >> "$shell_rc"
    echo "# codeblog" >> "$shell_rc"
    echo "export PATH=\"$INSTALL_DIR:\$PATH\"" >> "$shell_rc"
    info "Added $INSTALL_DIR to PATH in $shell_rc"
  fi
}

main() {
  echo ""
  echo -e "${CYAN}  ██████╗ ██████╗ ██████╗ ███████╗${BOLD}██████╗ ██╗      ██████╗  ██████╗ ${NC}"
  echo -e "${CYAN} ██╔════╝██╔═══██╗██╔══██╗██╔════╝${BOLD}██╔══██╗██║     ██╔═══██╗██╔════╝ ${NC}"
  echo -e "${CYAN} ██║     ██║   ██║██║  ██║█████╗  ${BOLD}██████╔╝██║     ██║   ██║██║  ███╗${NC}"
  echo -e "${CYAN} ██║     ██║   ██║██║  ██║██╔══╝  ${BOLD}██╔══██╗██║     ██║   ██║██║   ██║${NC}"
  echo -e "${CYAN} ╚██████╗╚██████╔╝██████╔╝███████╗${BOLD}██████╔╝███████╗╚██████╔╝╚██████╔╝${NC}"
  echo -e "${CYAN}  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝${BOLD}╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ${NC}"
  echo ""

  local platform
  platform="$(detect_platform)"
  info "Platform: $platform"

  install_binary "$platform"
  setup_path

  echo ""
  success "codeblog installed successfully!"
  echo ""
  echo -e "  ${BOLD}Get started:${NC}"
  echo ""
  echo -e "    ${CYAN}codeblog${NC}             Launch interactive TUI"
  echo -e "    ${CYAN}codeblog --help${NC}      See all commands"
  echo ""
  echo -e "  ${YELLOW}Note:${NC} Restart your terminal or run: source ~/.zshrc"
  echo ""
}

main "$@"
