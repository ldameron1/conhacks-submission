#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/conhacks-user/.env}"
SSID="${CCSECURE_SSID:-CCSecure}"
CONNECTION="${CCSECURE_CONNECTION:-CCSecure}"
DEVICE="${CCSECURE_DEVICE:-wlp2s0}"
FALLBACK_CONNECTION="${CCSECURE_FALLBACK:-Wifi}"
DOMAIN_SUFFIX="${CCSECURE_DOMAIN_SUFFIX:-conestogac.on.ca}"
ANONYMOUS_IDENTITY="${CCSECURE_ANONYMOUS_IDENTITY:-}"
SYSTEM_CA_CERTS="${CCSECURE_SYSTEM_CA_CERTS:-auto}"
PEAP_VERSION="${CCSECURE_PEAP_VERSION:-0}"
PMF="${CCSECURE_PMF:-2}"
WAIT_SECONDS="${CCSECURE_WAIT_SECONDS:-20}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<USAGE
Usage: $(basename "$0")

Configures and tests the CCSecure NetworkManager profile using:
  wifi_username
  wifi_password

Optional env overrides:
  CCSECURE_DOMAIN_SUFFIX
  CCSECURE_ANONYMOUS_IDENTITY
  CCSECURE_SYSTEM_CA_CERTS
  CCSECURE_PEAP_VERSION
  CCSECURE_PMF
  CCSECURE_WAIT_SECONDS

If CCSecure connects but cannot pass HTTPS traffic, the script restores
$FALLBACK_CONNECTION.

If CCSECURE_SYSTEM_CA_CERTS is left as "auto", the script tries both official
Conestoga variants:
1. Use System Certificate + domain conestogac.on.ca
2. Do Not Validate + no domain
USAGE
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  awk -v key="$key" '
    BEGIN { found = 0 }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      name = parts[1]
      sub(/^[[:space:]]+/, "", name)
      sub(/[[:space:]]+$/, "", name)
      if (name == key) {
        value = line
        sub(/^[^=]*=/, "", value)
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
          value = substr(value, 2, length(value) - 2)
        }
        print value
        found = 1
        exit
      }
    }
    END { if (!found) exit 1 }
  ' "$ENV_FILE"
}

wifi_username="$(read_env_value wifi_username || true)"
wifi_password="$(read_env_value wifi_password || true)"

if [[ -z "$wifi_username" ]]; then
  echo "Missing wifi_username in $ENV_FILE" >&2
  exit 1
fi

if [[ -z "$wifi_password" ]]; then
  echo "Missing wifi_password in $ENV_FILE" >&2
  exit 1
fi

if [[ "$SYSTEM_CA_CERTS" == "auto" ]]; then
  VARIANTS=(
    "system-cert|yes|$DOMAIN_SUFFIX"
    "no-validate|no|"
  )
else
  VARIANTS=(
    "manual|$SYSTEM_CA_CERTS|$DOMAIN_SUFFIX"
  )
fi

cleanup() {
  [[ -n "${SECRET_FILE:-}" && -f "$SECRET_FILE" ]] && rm -f "$SECRET_FILE"
}
trap cleanup EXIT

if ! nmcli -t -f NAME connection show | grep -Fxq "$CONNECTION"; then
  nmcli connection add \
    type wifi \
    con-name "$CONNECTION" \
    ifname "$DEVICE" \
    ssid "$SSID" \
    connection.permissions "user:$(whoami)" >/dev/null
fi

SECRET_FILE="$(mktemp)"
chmod 600 "$SECRET_FILE"
{
  printf '802-1x.identity:%s\n' "$wifi_username"
  printf '802-1x.password:%s\n' "$wifi_password"
} > "$SECRET_FILE"

attempt_connect() {
  local variant_name="$1"
  local variant_system_ca="$2"
  local variant_domain="$3"
  local start_time

  nmcli connection modify "$CONNECTION" \
    connection.autoconnect yes \
    connection.permissions "user:$(whoami)" \
    wifi-sec.key-mgmt wpa-eap \
    802-1x.eap peap \
    802-1x.phase1-peapver "$PEAP_VERSION" \
    802-1x.phase2-auth mschapv2 \
    802-1x.identity "$wifi_username" \
    802-1x.password "$wifi_password" \
    802-1x.password-flags 0 \
    802-1x.anonymous-identity "$ANONYMOUS_IDENTITY" \
    802-1x.domain-suffix-match "$variant_domain" \
    802-1x.system-ca-certs "$variant_system_ca" \
    802-11-wireless-security.proto rsn \
    802-11-wireless-security.pairwise ccmp \
    802-11-wireless-security.group ccmp \
    802-11-wireless-security.pmf "$PMF" \
    ipv4.method auto \
    ipv4.ignore-auto-dns no \
    ipv4.ignore-auto-routes no \
    ipv6.method auto \
    ipv6.ignore-auto-dns no \
    ipv6.ignore-auto-routes no \
    proxy.method none \
    connection.metered unknown

  echo "Activating $CONNECTION on $DEVICE using $variant_name..."
  start_time="$(date '+%Y-%m-%d %H:%M:%S')"
  if timeout --signal=TERM "$WAIT_SECONDS" \
    nmcli --wait "$WAIT_SECONDS" connection up "$CONNECTION" passwd-file "$SECRET_FILE"; then
    return 0
  fi

  echo "Variant $variant_name failed."
  journalctl --since "$start_time" --no-pager 2>/dev/null \
    | grep -Ei 'CCSecure|wlp2s0|NetworkManager|wpa_supplicant|802.1x|EAP|CTRL-EVENT|auth|reason|fail|secrets' \
    | tail -n 40 || true
  echo
  return 1
}

for variant in "${VARIANTS[@]}"; do
  IFS='|' read -r variant_name variant_system_ca variant_domain <<< "$variant"
  if attempt_connect "$variant_name" "$variant_system_ca" "$variant_domain"; then
    break
  fi
done

if [[ "$(nmcli -t -f NAME connection show --active | head -n 1)" != "$CONNECTION" ]]; then
  echo "Activation failed; restoring $FALLBACK_CONNECTION." >&2
  nmcli connection up "$FALLBACK_CONNECTION" || true
  echo
  echo "Current Wi-Fi state:"
  nmcli -f DEVICE,TYPE,STATE,CONNECTION device status || true
  nmcli -f GENERAL.STATE,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS device show "$DEVICE" || true
  exit 1
fi

echo "Checking network..."
if curl -4fsSI --max-time 8 https://example.com >/dev/null; then
  echo "$CONNECTION is connected and passing HTTPS traffic."
  nmcli -f GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS device show "$DEVICE"
  exit 0
fi

echo "$CONNECTION associated, but HTTPS traffic check failed; restoring $FALLBACK_CONNECTION." >&2
nmcli connection up "$FALLBACK_CONNECTION" || true
exit 2
