#!/bin/bash

set -euo pipefail

IMAGE_NAME="cmux-shell"
CONTAINER_NAME="cmux-browser-agent"
WORKER_PORT=39377
CDP_PORT=39382
PROMPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)
      if [[ $# -lt 2 ]]; then
        echo "Error: --prompt requires a value" >&2
        exit 1
      fi
      PROMPT="$2"
      shift 2
      ;;
    --prompt=*)
      PROMPT="${1#*=}"
      shift 1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PROMPT// }" ]]; then
  echo "Error: --prompt is required" >&2
  exit 1
fi

container_started=false

cleanup() {
  if [[ "$container_started" == true ]]; then
    echo "Stopping container..."
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    container_started=false
  fi
}

trap cleanup EXIT
trap 'exit 1' INT TERM

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Error: ANTHROPIC_API_KEY not set. Add it to your environment or .env before running." >&2
  exit 1
fi

OPENAI_ENV_ARGS=()
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Warning: OPENAI_API_KEY not set. Continuing without it."
else
  OPENAI_ENV_ARGS+=("-e" "OPENAI_API_KEY=${OPENAI_API_KEY}")
fi

if [[ "${SKIP_BUILD:-}" = "1" ]]; then
  echo "Skipping Docker image build because SKIP_BUILD=1"
else
  echo "Building Docker image..."
  docker build -t "$IMAGE_NAME" .
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

echo "Starting container..."
docker run -d \
  --rm \
  --privileged \
  --cgroupns=host \
  --tmpfs /run \
  --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v docker-data:/var/lib/docker \
  -p 39375:39375 \
  -p 39376:39376 \
  -p 39377:39377 \
  -p 39378:39378 \
  -p 39379:39379 \
  -p 39380:39380 \
  -p 39381:39381 \
  -p 39382:39382 \
  -p 39383:39383 \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  "${OPENAI_ENV_ARGS[@]}" \
  --name "$CONTAINER_NAME" \
  "$IMAGE_NAME" >/dev/null
container_started=true

# Allow services to initialize
sleep 5

printf "Waiting for worker health endpoint"
health_ready=false
for ((attempt=1; attempt<=120; attempt+=1)); do
  if curl -sSf "http://localhost:${WORKER_PORT}/health" >/dev/null 2>&1; then
    printf "\n"
    health_ready=true
    break
  fi
  printf "."
  sleep 1
done

if [[ "$health_ready" != true ]]; then
  echo ""
  echo "Worker health endpoint did not respond in time"
  exit 1
fi

echo "Running browser agent with provided prompt..."
docker exec \
  --workdir /cmux \
  --env BROWSER_AGENT_PROMPT="$PROMPT" \
  "$CONTAINER_NAME" \
  node /builtins/build/runBrowserAgentFromPrompt.js

echo "Browser agent run completed."
