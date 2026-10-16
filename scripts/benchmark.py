"""Measure a running NOX HTTP API; never substitute in-process requests.

Use a dedicated demo instance and set NOX_API_RATE_LIMIT high enough for the
chosen load. A 429 is counted as an error, not silently excluded from latency.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from urllib.parse import urlparse

import httpx


def positive_integer(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("value must be positive")
    return number


def percentile(samples: list[float], percent: float) -> float:
    """Nearest-rank percentile, including failed requests and network errors."""
    ordered = sorted(samples)
    return round(ordered[max(0, math.ceil(len(ordered) * percent / 100) - 1)], 3)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--path", help="Relative GET API path; defaults to first chat dashboard")
    parser.add_argument("--requests", type=positive_integer, default=300)
    parser.add_argument("--concurrency", type=positive_integer, default=10)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--max-p95-ms", type=float, help="Optional measured latency budget")
    parser.add_argument("--demo", action="store_true", help="Use explicit demo authentication")
    parser.add_argument("--token-env", default="NOX_BENCHMARK_TOKEN")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    parsed = urlparse(args.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username:
        parser.error("base URL must be HTTP(S) and must not contain credentials")
    if args.warmup < 0 or args.timeout <= 0 or not math.isfinite(args.timeout):
        parser.error("warmup must be nonnegative and timeout must be positive")
    if args.max_p95_ms is not None and (args.max_p95_ms <= 0 or not math.isfinite(args.max_p95_ms)):
        parser.error("p95 budget must be finite and positive")
    if args.path and (not args.path.startswith("/") or args.path.startswith("//")):
        parser.error("path must be relative to base URL and begin with one slash")
    if not args.demo and not os.environ.get(args.token_env):
        parser.error(f"use --demo or provide a bearer token through {args.token_env}")
    return args


async def authenticate(client: httpx.AsyncClient, args: argparse.Namespace) -> str:
    if not args.demo:
        return str(os.environ[args.token_env])
    response = await client.post("/api/v1/auth/demo")
    response.raise_for_status()
    return str(response.json()["access_token"])


async def benchmark(args: argparse.Namespace) -> dict[str, object]:
    limits = httpx.Limits(
        max_connections=args.concurrency, max_keepalive_connections=args.concurrency
    )
    async with httpx.AsyncClient(
        base_url=args.base_url.rstrip("/"), timeout=args.timeout, limits=limits
    ) as client:
        token = await authenticate(client, args)
        client.headers["Authorization"] = f"Bearer {token}"
        path = args.path
        if path is None:
            response = await client.get("/api/v1/chats")
            response.raise_for_status()
            chats = response.json()
            items = chats if isinstance(chats, list) else chats["items"]
            if not items:
                raise ValueError("No accessible chat; pass an existing dashboard path")
            path = f"/api/v1/chats/{items[0]['id']}/dashboard"
        for _ in range(args.warmup):
            response = await client.get(path)
            response.raise_for_status()

        latencies_ms: list[float] = []
        statuses: Counter[str] = Counter()
        next_request = 0

        async def worker() -> None:
            nonlocal next_request
            while next_request < args.requests:
                # No await before increment: one event loop safely claims each index.
                next_request += 1
                started = perf_counter()
                try:
                    result = await client.get(path)
                    statuses[str(result.status_code)] += 1
                except httpx.RequestError as exc:
                    # Exception text can contain a URL or headers; emit only class name.
                    statuses[type(exc).__name__] += 1
                finally:
                    latencies_ms.append((perf_counter() - started) * 1000)

        started = perf_counter()
        await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        duration_seconds = perf_counter() - started

    successful = sum(
        count for code, count in statuses.items() if code.isdigit() and 200 <= int(code) < 300
    )
    measured_p95 = percentile(latencies_ms, 95)
    result: dict[str, object] = {
        "timestamp_utc": datetime.now(UTC).isoformat(),
        "transport": "HTTP over network to running API",
        "base_url": args.base_url,
        "path": path,
        "authentication": "demo" if args.demo else "provided session",
        "requests": len(latencies_ms),
        "concurrency": args.concurrency,
        "warmup_requests_excluded": args.warmup,
        "duration_seconds": round(duration_seconds, 6),
        "requests_per_second": round(len(latencies_ms) / duration_seconds, 3),
        "successful_requests_per_second": round(successful / duration_seconds, 3),
        "latency_ms": {
            "p50": percentile(latencies_ms, 50),
            "p95": measured_p95,
            "p99": percentile(latencies_ms, 99),
            "maximum": round(max(latencies_ms), 3),
        },
        "latency_includes_errors": True,
        "percentile_method": "nearest rank",
        "successes": successful,
        "errors": args.requests - successful,
        "status_counts": dict(sorted(statuses.items())),
    }
    if args.max_p95_ms is not None:
        result["targets"] = {"max_p95_ms": args.max_p95_ms, "errors": 0}
        result["targets_met"] = measured_p95 <= args.max_p95_ms and successful == args.requests
    return result


def main() -> int:
    args = arguments()
    try:
        result = asyncio.run(benchmark(args))
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        # Never log response bodies or exception strings from authentication.
        print(
            json.dumps({"error": type(exc).__name__, "phase": "setup or warmup"}), file=sys.stderr
        )
        return 2
    output = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    print(output, end="")
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    return 1 if result["errors"] or result.get("targets_met") is False else 0


if __name__ == "__main__":
    raise SystemExit(main())
