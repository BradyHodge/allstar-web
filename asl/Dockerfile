FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive

# Stub out systemctl/service so package post-install scripts don't fail
RUN printf '#!/bin/sh\nexit 0\n' > /usr/bin/systemctl && \
    printf '#!/bin/sh\nexit 0\n' > /usr/sbin/service  && \
    chmod +x /usr/bin/systemctl /usr/sbin/service

# Base packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget curl ca-certificates gnupg lsb-release \
    gettext-base procps dahdi \
    && rm -rf /var/lib/apt/lists/*

# Add AllStarLink3 APT repository
RUN cd /tmp \
    && wget -q https://repo.allstarlink.org/public/asl-apt-repos.deb12_all.deb \
    && dpkg -i asl-apt-repos.deb12_all.deb \
    && rm asl-apt-repos.deb12_all.deb

# Install ASL3 (Asterisk 20 + app_rpt3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    asl3-asterisk \
    asl3-asterisk-config \
    asl3-asterisk-modules \
    && rm -rf /var/lib/apt/lists/*

# Ensure asterisk user exists and owns its directories
RUN getent passwd asterisk > /dev/null 2>&1 || \
    useradd -r -d /var/lib/asterisk -s /bin/false asterisk

RUN mkdir -p \
      /var/log/asterisk \
      /var/spool/asterisk \
      /var/lib/asterisk \
      /var/run/asterisk \
      /etc/asterisk \
    && chown -R asterisk:asterisk \
      /var/log/asterisk \
      /var/spool/asterisk \
      /var/lib/asterisk \
      /var/run/asterisk \
      /etc/asterisk

# Add asterisk to dahdi group for device access
RUN getent group dahdi >/dev/null 2>&1 && usermod -aG dahdi asterisk || true

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
