# ngrok v3 Compatibility Fix

- **Timestamp**: 2026-04-30T01:21:00-04:00
- **Agent**: Kiro CLI (Codex)
- **Task**: Fix ngrok startup for v3.39.1 compatibility and aggressive authtoken re-configuration

## Problem

User reported ngrok failing with two issues:
1. `Flag --scheme has been deprecated, use --url instead` (ngrok v3 deprecation)
2. `ERR_NGROK_105` - authentication failed due to corrupted authtoken parsing from `.env`

## Root Cause

1. **Deprecated flag**: ngrok v3 deprecated `--scheme=https` flag (HTTPS is now default)
2. **Authtoken parsing**: The sed-based parsing was not properly stripping quotes, causing the token to be corrupted when passed to `ngrok config add-authtoken`

## Fix Applied

**File**: `scripts/start-public.sh`

### 1. Removed deprecated `--scheme=https` flag and pinned the local target to IPv4 loopback
```bash
# Before
nohup ngrok http --scheme=https $PORT --log stdout >/tmp/route-rehearsal-ngrok.log 2>&1 &

# After (ngrok v3 uses HTTPS by default; avoid localhost IPv6 ambiguity)
nohup ngrok http "$NGROK_FORWARD_TARGET" --log stdout >/tmp/route-rehearsal-ngrok.log 2>&1 &
```

### 2. Improved authtoken parsing and aggressive re-configuration
```bash
# Before
NGROK_AUTH_TOKEN="$(grep '^NGROK_AUTH_TOKEN=' .env | sed 's/^NGROK_AUTH_TOKEN=//' | sed 's/^"//;s/"$//' | head -n 1)"
if [[ -n "$NGROK_AUTH_TOKEN" ]]; then
  export NGROK_AUTHTOKEN="$NGROK_AUTH_TOKEN"
  echo "Validating and configuring ngrok authtoken..."
  ngrok config add-authtoken "$NGROK_AUTH_TOKEN" >/dev/null 2>&1 || true
fi

# After
NGROK_AUTH_TOKEN="${NGROK_AUTH_TOKEN:-$(read_env_value NGROK_AUTH_TOKEN)}"
if [[ -n "$NGROK_AUTH_TOKEN" ]]; then
  echo "Configuring ngrok authtoken from .env/env..."
  ngrok config add-authtoken "$NGROK_AUTH_TOKEN" >/tmp/route-rehearsal-ngrok-auth.log 2>&1
  export NGROK_AUTHTOKEN="$NGROK_AUTH_TOKEN"
else
  echo "Warning: NGROK_AUTH_TOKEN not found in environment or .env."
fi
```

**Key improvements**:
- Uses a small `.env` parser to preserve token values without expanding shell characters
- Aggressively re-configures authtoken every startup (per user request)
- Redacts auth failure output before showing it
- Forwards ngrok to `127.0.0.1:$PORT` instead of `localhost:$PORT` to avoid timeout-prone IPv6 resolution
- Verifies the public URL responds before printing it

## Verification

- ✅ ngrok v3.39.1 compatibility (no deprecated flags)
- ✅ Authtoken properly parsed from `.env` without corruption
- ✅ Aggressive re-configuration on every startup
- ✅ HTTPS tunnel still created by default (ngrok v3 behavior)
- ✅ Bounded startup test showed ngrok forwarding to `addr=http://127.0.0.1:8080`

## Impact

This restores ngrok public mode functionality for ngrok v3 and ensures the authtoken is always correctly configured from the `.env` file.
