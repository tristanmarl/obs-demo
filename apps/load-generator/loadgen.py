import json
import os
import random
import time
import urllib.error
import urllib.request

BASE_URL = os.getenv("PLATFORM_URL", os.getenv("COMMAND_URL", "http://platform-api:8080")).rstrip("/")
DELAY_MS = int(os.getenv("LOADGEN_DELAY_MS", "750"))
BURST = int(os.getenv("LOADGEN_BURST", "1"))
TIMEOUT = float(os.getenv("LOADGEN_TIMEOUT_SECONDS", "5"))
ERROR_RATE = min(0.25, max(0.0, float(os.getenv("LOADGEN_ERROR_RATE", "0.02"))))

COMMANDS = [
    ("status", "GET", "/api/status", None, 1),
    ("artifacts", "GET", "/api/artifacts", None, 3),
    ("quota", "GET", "/api/quota", None, 3),
    ("release", "POST", "/api/releases", {"service": "checkout-service", "version": "1.4.2", "environment": "staging"}, 5),
    ("incident-recommendation", "GET", "/api/incidents/recommendation", None, 1),
]


def call(name, method, path, body):
    payload = json.dumps(body).encode() if body else None
    request = urllib.request.Request(
        f"{BASE_URL}{path}", data=payload, method=method, headers={"content-type": "application/json"}
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    except Exception as exc:
        print(json.dumps({"event": "loadgen.error", "target": name, "error": str(exc)}), flush=True)
        return
    print(json.dumps({"event": "loadgen.request", "target": name, "status": status, "latency_ms": int((time.monotonic() - started) * 1000)}), flush=True)


def main():
    weighted = [command for command in COMMANDS for _ in range(command[4])]
    print(json.dumps({"event": "loadgen.start", "base_url": BASE_URL, "delay_ms": DELAY_MS, "burst": BURST, "error_rate": ERROR_RATE}), flush=True)
    while True:
        for _ in range(BURST):
            if random.random() < ERROR_RATE:
                call("intentional-error", "GET", "/api/quota?force_error=true", None)
            else:
                name, method, path, body, _weight = random.choice(weighted)
                call(name, method, path, body)
        time.sleep(max(DELAY_MS, 0) / 1000)


if __name__ == "__main__":
    main()
