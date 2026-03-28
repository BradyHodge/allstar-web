#!/usr/bin/env bash
# AllStar Web Transceiver - Asterisk entrypoint
# Copies config templates from the read-only bind mount, injects
# environment variables, then starts Asterisk in the foreground.
set -euo pipefail

echo "==================================================="
echo "  AllStar Web Transceiver - Node ${NODE_NUMBER}"
echo "==================================================="

# ── Copy templates to the writable volume ──────────────
# /etc/asterisk-templates is a read-only bind mount from ./asl/conf/
# /etc/asterisk is a named volume (writable)
echo "Copying config templates..."
# Copy Asterisk configs (exclude the dahdi subdir)
find /etc/asterisk-templates -maxdepth 1 -not -path /etc/asterisk-templates -exec cp -af {} /etc/asterisk/ \;

# Copy DAHDI system.conf to the correct location
if [ -f /etc/asterisk-templates/dahdi/system.conf ]; then
    mkdir -p /etc/dahdi
    cp /etc/asterisk-templates/dahdi/system.conf /etc/dahdi/system.conf
fi

# ── Inject environment variables ───────────────────────
# Only substitute the variables we control. Using an explicit variable
# list prevents accidental substitution of Asterisk dialplan variables
# like ${EXTEN} or ${CALLERID(number)}.
VARS='${NODE_NUMBER} ${NODE_PASSWORD} ${SIP_PASSWORD} ${AMI_SECRET} ${STUN_SERVER}'

for f in \
    rpt.conf \
    iax.conf \
    pjsip.conf \
    extensions.conf \
    manager.conf \
    rtp.conf \
    rpt_http_registrations.conf; do

    TARGET="/etc/asterisk/${f}"
    if [ -f "${TARGET}" ]; then
        envsubst "${VARS}" < "${TARGET}" > "${TARGET}.tmp"
        mv "${TARGET}.tmp" "${TARGET}"
    fi
done

chown -R asterisk:asterisk /etc/asterisk

# ── DAHDI ──────────────────────────────────────────────
if [ -c "/dev/dahdi/ctl" ]; then
    echo "DAHDI device found. Running dahdi_cfg..."
    dahdi_cfg -vv 2>/dev/null || true
else
    echo ""
    echo "WARNING: /dev/dahdi not found!"
    echo "  Run ./host-setup.sh on the VPS host to install DAHDI,"
    echo "  then restart this container."
    echo "  Continuing anyway - Asterisk will start but the AllStar"
    echo "  node channel (DAHDI/pseudo) will not be available."
    echo ""
fi

# ── Start Asterisk ─────────────────────────────────────
echo "Starting Asterisk (node ${NODE_NUMBER})..."
exec asterisk -f -p -U asterisk -G asterisk
