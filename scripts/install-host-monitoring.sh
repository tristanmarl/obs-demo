#!/usr/bin/env bash
# Run ON the EC2/k3s host: sudo ./scripts/install-host-monitoring.sh
# Installs MariaDB, the Dynatrace OTel Collector and obs-edge-agent as native services,
# then points result-api at the host database.
# Token scopes needed: metrics.ingest, logs.ingest, openTelemetryTrace.ingest.
set -euo pipefail

load_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done < "$1"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./scripts/install-host-monitoring.sh"
  exit 1
fi

if [ -f .env ]; then
  load_env_file .env
fi

: "${DT_TENANT_URL:?Set DT_TENANT_URL in .env}"
DT_TOKEN="${DT_OTEL_INGEST_TOKEN:-${DT_DATA_INGEST_TOKEN:-}}"
if [ -z "$DT_TOKEN" ]; then
  echo "Set DT_OTEL_INGEST_TOKEN (scopes: metrics.ingest, logs.ingest, openTelemetryTrace.ingest)."
  exit 1
fi

HOST_DB_IP="${HOST_DB_IP:-$(hostname -I | awk '{print $1}')}"
COLLECTOR_VERSION="${COLLECTOR_VERSION:-0.59.0}"
INGRESS_URL="${INGRESS_URL:-http://${HOST_DB_IP}}"
if [ -z "${JOURNALD_DIRECTORY:-}" ]; then
  if [ -d /var/log/journal ]; then JOURNALD_DIRECTORY=/var/log/journal; else JOURNALD_DIRECTORY=/run/log/journal; fi
fi
SERVICE_VERSION="${SERVICE_VERSION:-${IMAGE_TAG:-dev}}"
KUBECTL="${KUBECTL:-kubectl}"
export HOST_DB_IP

for tool in docker envsubst openssl curl "$KUBECTL"; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required."; exit 1; }
done

install -d -m 755 /etc/obs-demo

# MariaDB + exporter
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mariadb-server prometheus-mysqld-exporter

if [ ! -f /etc/obs-demo/host-db.env ]; then
  (umask 077; printf 'DB_PASSWORD=%s\nEXPORTER_PASSWORD=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 16)" > /etc/obs-demo/host-db.env)
fi
load_env_file /etc/obs-demo/host-db.env

printf '[mysqld]\nbind-address = %s\n' "$HOST_DB_IP" > /etc/mysql/mariadb.conf.d/60-obs-demo.cnf
systemctl restart mariadb

mysql <<SQL
CREATE DATABASE IF NOT EXISTS obs_demo;
CREATE TABLE IF NOT EXISTS obs_demo.results (
  id bigint auto_increment primary key,
  job_id varchar(64) not null,
  status varchar(32) not null,
  message varchar(255),
  created_at timestamp default current_timestamp
);
CREATE USER IF NOT EXISTS 'obs_demo'@'%' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER 'obs_demo'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON obs_demo.* TO 'obs_demo'@'%';
CREATE USER IF NOT EXISTS 'exporter'@'localhost' IDENTIFIED BY '${EXPORTER_PASSWORD}';
ALTER USER 'exporter'@'localhost' IDENTIFIED BY '${EXPORTER_PASSWORD}';
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'localhost';
FLUSH PRIVILEGES;
SQL

(umask 027; printf '[client]\nuser=exporter\npassword=%s\nsocket=/run/mysqld/mysqld.sock\n' "$EXPORTER_PASSWORD" > /etc/mysql/obs-demo-exporter.cnf)
chown root:prometheus /etc/mysql/obs-demo-exporter.cnf
chmod 640 /etc/mysql/obs-demo-exporter.cnf
if grep -q '^ARGS=' /etc/default/prometheus-mysqld-exporter 2>/dev/null; then
  sed -i 's|^ARGS=.*|ARGS="--config.my-cnf=/etc/mysql/obs-demo-exporter.cnf --web.listen-address=127.0.0.1:9104"|' /etc/default/prometheus-mysqld-exporter
else
  echo 'ARGS="--config.my-cnf=/etc/mysql/obs-demo-exporter.cnf --web.listen-address=127.0.0.1:9104"' >> /etc/default/prometheus-mysqld-exporter
fi
systemctl restart prometheus-mysqld-exporter
echo "WARNING: MariaDB listens on ${HOST_DB_IP}:3306. Do not expose 3306 in the EC2 security group."

# Dynatrace OTel Collector
case "$(uname -m)" in
  x86_64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo "Unsupported architecture $(uname -m)"; exit 1 ;;
esac
TARBALL="dynatrace-otel-collector_${COLLECTOR_VERSION}_Linux_${ARCH}.tar.gz"
BASE_URL="https://github.com/Dynatrace/dynatrace-otel-collector/releases/download/v${COLLECTOR_VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/$TARBALL" "$BASE_URL/$TARBALL"
curl -fsSL -o "$TMP/checksums.txt" "$BASE_URL/checksums.txt"
(cd "$TMP" && sha256sum -c --ignore-missing checksums.txt)
tar -xzf "$TMP/$TARBALL" -C "$TMP" dynatrace-otel-collector
install -m 755 "$TMP/dynatrace-otel-collector" /usr/local/bin/dynatrace-otel-collector
install -m 644 host/collector/config.yaml /etc/obs-demo/otel-collector.yaml
(umask 077; printf 'DT_ENDPOINT=%s/api/v2/otlp\nDT_API_TOKEN=%s\nJOURNALD_DIRECTORY=%s\n' "${DT_TENANT_URL%/}" "$DT_TOKEN" "$JOURNALD_DIRECTORY" > /etc/obs-demo/otel-collector.env)

# Edge agent
docker build -q --target bin --output "type=local,dest=$TMP/edge" host/edge-agent >/dev/null
install -m 755 "$TMP/edge/obs-edge-agent" /usr/local/bin/obs-edge-agent
printf 'INGRESS_URL=%s\nSERVICE_VERSION=%s\n' "$INGRESS_URL" "$SERVICE_VERSION" > /etc/obs-demo/edge-agent.env

install -m 644 host/systemd/obs-demo-otel-collector.service host/systemd/obs-edge-agent.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now obs-demo-otel-collector obs-edge-agent
systemctl restart obs-demo-otel-collector obs-edge-agent

# Kubernetes wiring
envsubst < deploy/k8s/host/host-db.yaml.tpl | $KUBECTL apply -f -
$KUBECTL -n obs-demo create secret generic host-db \
  --from-literal=RESULT_DB_URL="mysql://obs_demo:${DB_PASSWORD}@host-db.obs-demo.svc.cluster.local:3306/obs_demo" \
  --dry-run=client -o yaml | $KUBECTL apply -f -
$KUBECTL -n obs-demo set env deployment/result-api --from=secret/host-db
$KUBECTL -n obs-demo rollout status deployment/result-api --timeout=180s

cat <<MSG

Host monitoring installed.
  systemctl status obs-demo-otel-collector obs-edge-agent mariadb prometheus-mysqld-exporter
  journalctl -u obs-demo-otel-collector -u obs-edge-agent -f
  mysql -e 'SELECT COUNT(*) FROM obs_demo.results'

In Dynatrace (the OpenTelemetry Host Monitoring extension must be activated), try:
  fetch dt.entity.otel:host
  smartscapeNodes "otel_process"
Entity availability and names can vary by tenant and extension version; see docs/host-monitoring.md.
MSG
