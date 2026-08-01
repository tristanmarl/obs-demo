import json
import os
import random
import time
import urllib.error
import urllib.request

BASE_URL = os.getenv("GATEWAY_URL", "http://gateway-api:8080").rstrip("/")
DELAY_MS = int(os.getenv("LOADGEN_DELAY_MS", "750"))
BURST = max(1, int(os.getenv("LOADGEN_BURST", "1")))
TIMEOUT = float(os.getenv("LOADGEN_TIMEOUT_SECONDS", "5"))
try:
    ERROR_RATE = min(0.25, max(0.0, float(os.getenv("LOADGEN_ERROR_RATE", "0.05"))))
except ValueError:
    ERROR_RATE = 0.05

COMMANDS = [
    ("catalog-list", "GET", "/api/catalog", None, 3),
    ("catalog-detail", "GET", "/api/catalog/item-a", None, 2),
    ("cache-read", "GET", "/api/cache", None, 2),
    ("cache-increment", "POST", "/api/cache", None, 2),
    ("job-create", "POST", "/api/jobs", {"name": "demo-job", "workUnits": 10}, 3),
    ("job-list", "GET", "/api/jobs", None, 2),
    ("job-detail", "GET", "/api/jobs", None, 2),
    ("analysis", "GET", "/api/analysis", None, 1),
]

FAILURE_COMMANDS = [
    ("cache-error", "GET", "/api/cache?force_error=true", None),
    ("catalog-miss", "GET", "/api/catalog/missing-item", None),
    ("job-validation", "POST", "/api/jobs", {"name": "invalid job", "workUnits": 10}),
]


def call(name, method, path, body):
    payload = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{BASE_URL}{path}", data=payload, method=method, headers={"content-type": "application/json"})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read()
            status = response.status
            parsed = json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        status = exc.code
        parsed = {}
    except Exception as exc:
        print(json.dumps({"event": "loadgen.error", "target": name, "error": str(exc)}), flush=True)
        return status if "status" in locals() else None, {}
    print(json.dumps({"event": "loadgen.request", "target": name, "status": status, "latency_ms": int((time.monotonic() - started) * 1000)}), flush=True)
    return status, parsed


def main():
    weighted = [command for command in COMMANDS for _ in range(command[4])]
    last_job_id = None
    print(json.dumps({"event": "loadgen.start", "base_url": BASE_URL, "delay_ms": DELAY_MS, "burst": BURST, "error_rate": ERROR_RATE}), flush=True)
    while True:
        for _ in range(BURST):
            if random.random() < ERROR_RATE:
                name, method, path, body = random.choice(FAILURE_COMMANDS)
                call(name, method, path, body)
                continue
            name, method, path, body, _weight = random.choice(weighted)
            if name == "job-detail":
                if last_job_id:
                    call(name, method, f"/api/jobs/{last_job_id}", body)
                continue
            status, response = call(name, method, path, body)
            if name == "job-create" and status == 200:
                last_job_id = response.get("jobId")
                if last_job_id:
                    call("job-detail", "GET", f"/api/jobs/{last_job_id}", None)
        time.sleep(max(DELAY_MS, 0) / 1000)


if __name__ == "__main__":
    main()
