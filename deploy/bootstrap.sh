#!/usr/bin/env bash
set -euo pipefail
# Run once over SSH on a fresh Ubuntu 24.04 Droplet.
export DEBIAN_FRONTEND=noninteractive
cloud-init status --wait
apt-get update
apt-get install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$(dpkg --print-architecture)" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
if ! swapon --show | grep -q .; then
    if [ ! -e /swapfile ]; then
        fallocate -l 1G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
    fi
fi
operator_ip=${SSH_CONNECTION%% *}
test -n "$operator_ip"
ufw allow from "$operator_ip" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
if [ ! -d /opt/rdm/.git ]; then
    git clone https://github.com/Buulehenry/rdm.git /opt/rdm
fi
install -d -o 10001 -g 10001 /opt/rdm/deploy/data /opt/rdm/deploy/feedback
install -d /opt/rdm/private-osrm/data
printf 'Bootstrap complete. Transfer deployment files, database and road graph before starting.\n'
