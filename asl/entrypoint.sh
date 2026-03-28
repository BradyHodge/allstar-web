#!/usr/bin/env bash
# AllStar Web Transceiver - Asterisk entrypoint
# Copies config templates, injects env vars, starts Asterisk.
# Per-user node configs are written by the API container into
# the shared 'asterisk-users' volume at /etc/asterisk/users/.
set -euo pipefail

echo "==================================================="
echo "  AllStar Web Transceiver - Multi-User Node Server"
echo "==================================================="

# ── Copy templates to writable /etc/asterisk ───────────
# Copies only top-level files (excludes the dahdi/ subdir which is handled below)
echo "Copying config templates..."
find /etc/asterisk-templates -maxdepth 1 -not -path /etc/asterisk-templates \
    -exec cp -af {} /etc/asterisk/ \;

# Copy DAHDI system.conf to the correct location
if [ -f /etc/asterisk-templates/dahdi/system.conf ]; then
    mkdir -p /etc/dahdi
    cp /etc/asterisk-templates/dahdi/system.conf /etc/dahdi/system.conf
fi

# ── Inject environment variables ────────────────────────
# Only AMI_SECRET and STUN_SERVER are needed in the static configs now.
# NODE_NUMBER/NODE_PASSWORD are handled per-user by the API container.
VARS='${AMI_SECRET} ${STUN_SERVER}'

for f in manager.conf rtp.conf; do
    TARGET="/etc/asterisk/${f}"
    if [ -f "${TARGET}" ]; then
        envsubst "${VARS}" < "${TARGET}" > "${TARGET}.tmp"
        mv "${TARGET}.tmp" "${TARGET}"
    fi
done

# ── Ensure users directory exists (shared volume) ───────
# The API container writes user configs here; Asterisk reads them.
# #tryinclude in configs gracefully handles the files not existing yet.
mkdir -p /etc/asterisk/users
chown -R asterisk:asterisk /etc/asterisk /etc/asterisk/users 2>/dev/null || true

# ── DAHDI ───────────────────────────────────────────────
if [ -c "/dev/dahdi/ctl" ]; then
    echo "DAHDI device found. Running dahdi_cfg..."
    dahdi_cfg -vv 2>/dev/null || true
else
    echo ""
    echo "WARNING: /dev/dahdi not found!"
    echo "  Run ./host-setup.sh on the VPS host to install DAHDI,"
    echo "  then restart this container."
    echo ""
fi

echo "Starting Asterisk..."
exec asterisk -f -p -U asterisk -G asterisk
