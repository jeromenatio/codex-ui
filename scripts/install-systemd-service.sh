#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="codex-ui"
SERVICE_USER="root"
SERVICE_GROUP="root"
APP_DIR="${APP_DIR:-/projects/codex-ui}"
PORT="${PORT:-4180}"
NODE_ENV="${NODE_ENV:-production}"
SYSTEMD_DIR="/etc/systemd/system"
SERVICE_PATH="${SYSTEMD_DIR}/${SERVICE_NAME}.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script must be run as root." >&2
  echo "Example: sudo $0" >&2
  exit 1
fi

if [[ ! -d "${APP_DIR}" ]]; then
  echo "Application directory not found: ${APP_DIR}" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required but was not found." >&2
  exit 1
fi

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Codex UI Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=${NODE_ENV}
Environment=PORT=${PORT}
ExecStartPre=/usr/bin/npm run build
ExecStart=/usr/bin/node dist-server/index.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Installed ${SERVICE_NAME} service at ${SERVICE_PATH}"
echo "Useful commands:"
echo "  systemctl status ${SERVICE_NAME}"
echo "  journalctl -u ${SERVICE_NAME} -f"
