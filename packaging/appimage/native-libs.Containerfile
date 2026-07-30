FROM docker.io/library/debian:bookworm-slim@sha256:63a496b5d3b99214b39f5ed70eb71a61e590a77979c79cbee4faf991f8c0783e

ENV DEBIAN_FRONTEND=noninteractive
ARG DEBIAN_SNAPSHOT=20260730T090000Z

RUN printf '%s\n' \
        'Types: deb' \
        "URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}" \
        'Suites: bookworm bookworm-updates' \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
        'Check-Valid-Until: no' \
        '' \
        'Types: deb' \
        "URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}" \
        'Suites: bookworm-security' \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
        'Check-Valid-Until: no' \
        > /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get install -y --no-install-recommends \
        file=1:5.44-3 \
        libasound2=1.2.8-1+b1 \
        libdbus-1-3=1.14.10-1~deb12u1 \
        libdrm2=2.4.114-1+b1 \
        libegl1=1.6.0-1 \
        libepoxy0=1.5.10-1 \
        libfontconfig1=2.14.1-4 \
        libfreetype6=2.12.1+dfsg-5+deb12u4 \
        libgbm1=22.3.6-1+deb12u2 \
        libgl1=1.6.0-1 \
        libglx0=1.6.0-1 \
        libgtk-3-0=3.24.38-2~deb12u3 \
        libwayland-client0=1.21.0-1 \
        libwayland-cursor0=1.21.0-1 \
        libwayland-egl1=1.21.0-1 \
        libx11-xcb1=2:1.8.4-2+deb12u2 \
        libxcomposite1=1:0.4.5-1 \
        libxcursor1=1:1.2.1-1 \
        libxdamage1=1:1.1.6-1 \
        libxext6=2:1.3.4-1+b1 \
        libxfixes3=1:6.0.0-2 \
        libxi6=2:1.8-1+b1 \
        libxinerama1=2:1.1.4-3 \
        libxkbcommon0=1.5.0-1 \
        libxrandr2=2:1.5.2-2+b1 \
        libxrender1=1:0.9.10-1.1 \
        libxtst6=2:1.2.3-1.1 \
        pax-utils=1.3.7-1 \
    && rm -rf /var/lib/apt/lists/*

CMD ["/bin/sh"]
