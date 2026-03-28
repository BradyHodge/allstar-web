#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
#  AllStar Web Transceiver - Host Setup
#  Run this ONCE on your Debian/Ubuntu VPS before starting
#  the Docker stack. Installs DAHDI kernel modules required
#  by AllStarLink for the pseudo audio channel.
# ─────────────────────────────────────────────────────────
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
    echo "ERROR: Run as root (sudo ./host-setup.sh)" >&2
    exit 1
fi

DISTRO=$(lsb_release -is 2>/dev/null || echo "Unknown")
echo "=== AllStar Host Setup on ${DISTRO} ==="

# Install kernel headers and DAHDI
echo "--- Installing DAHDI kernel modules ---"
apt-get update -qq

# Try to get headers for the running kernel first
KERNEL=$(uname -r)
if apt-get install -y "linux-headers-${KERNEL}" 2>/dev/null; then
    echo "Installed headers for kernel ${KERNEL}"
else
    echo "Exact kernel headers not found, trying generic..."
    apt-get install -y linux-headers-generic || true
fi

apt-get install -y dahdi-linux-dkms dahdi-tools

echo "--- Loading DAHDI modules ---"
modprobe dahdi       && echo "  dahdi loaded OK"     || echo "  WARNING: dahdi load failed"
modprobe dahdi_dummy && echo "  dahdi_dummy loaded OK" || echo "  WARNING: dahdi_dummy not found (may need reboot)"

# Persist across reboots
grep -qxF "dahdi"       /etc/modules || echo "dahdi"       >> /etc/modules
grep -qxF "dahdi_dummy" /etc/modules || echo "dahdi_dummy" >> /etc/modules

# Run DAHDI config
if command -v dahdi_cfg >/dev/null 2>&1; then
    echo "--- Configuring DAHDI ---"
    dahdi_cfg -vv 2>/dev/null || true
fi

echo ""
echo "=== DAHDI Setup Complete ==="
if [ -d /dev/dahdi ]; then
    echo "  /dev/dahdi contents:"
    ls -la /dev/dahdi/
else
    echo "  WARNING: /dev/dahdi not present yet."
    echo "  If modules loaded but no /dev/dahdi, try: dahdi_cfg -vv"
    echo "  Or reboot and run this script again."
fi

echo ""
echo "Next steps:"
echo "  1. cp .env.example .env"
echo "  2. Edit .env with your AllStar node number and password"
echo "  3. docker compose up -d"
