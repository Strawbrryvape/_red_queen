# rq_bridge.py — Red Queen v2 HTTPS Bridge
# Posts consensus results to Supabase or custom API endpoint.
# Uses only urllib (stdlib) to keep zero-dependency promise.

import json
import urllib.request
import urllib.error
import time
from typing import Dict, Optional
from dataclasses import asdict

from rq_consensus_engine import ConsensusResult


class ConsensusBridge:
    """Bridge: local mesh consensus → live backend.

    Two modes:
    1. Supabase REST API (direct table inserts)
    2. Custom webhook endpoint (e.g., /api/rq-consensus on your Netlify app)
    """

    def __init__(
        self,
        endpoint_url: str = None,
        api_key: str = None,
        supabase_url: str = None,
        supabase_key: str = None,
        table_name: str = "rq_consensus_log",
        timeout: float = 10.0,
        retry_attempts: int = 3,
        retry_backoff: float = 1.0
    ):
        self.endpoint_url = endpoint_url
        self.api_key = api_key
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.table_name = table_name
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_backoff = retry_backoff

        self._stats = {"success": 0, "failure": 0, "last_error": None}

    def _headers(self) -> Dict[str, str]:
        """Build request headers."""
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.supabase_key:
            headers["apikey"] = self.supabase_key
            headers["Authorization"] = f"Bearer {self.supabase_key}"
        return headers

    def _serialize_result(self, result: ConsensusResult) -> dict:
        """Convert ConsensusResult to JSON-serializable dict."""
        return {
            "round_id": result.round_id,
            "timestamp": result.timestamp,
            "consensus_vector": result.consensus_vector,
            "participating_nodes": result.participating_nodes,
            "agreement_score": result.agreement_score,
            "convergence_time_ms": result.convergence_time_ms,
            "raw_vectors": result.raw_vectors,
            "metadata": result.metadata
        }

    def _post(self, url: str, payload: dict) -> bool:
        """POST with retry logic. Returns True on success."""
        data = json.dumps(payload).encode("utf-8")
        headers = self._headers()

        for attempt in range(self.retry_attempts):
            try:
                req = urllib.request.Request(
                    url,
                    data=data,
                    headers=headers,
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    if resp.status in (200, 201, 204):
                        self._stats["success"] += 1
                        return True
            except urllib.error.HTTPError as e:
                self._stats["last_error"] = f"HTTP {e.code}: {e.reason}"
                if e.code >= 500:  # server error, retry
                    time.sleep(self.retry_backoff * (2 ** attempt))
                    continue
                break
            except Exception as e:
                self._stats["last_error"] = str(e)
                time.sleep(self.retry_backoff * (2 ** attempt))

        self._stats["failure"] += 1
        return False

    def send_to_endpoint(self, result: ConsensusResult) -> bool:
        """Send consensus result to custom webhook endpoint."""
        if not self.endpoint_url:
            raise ValueError("endpoint_url not configured")
        return self._post(self.endpoint_url, self._serialize_result(result))

    def send_to_supabase(self, result: ConsensusResult) -> bool:
        """Insert consensus result into Supabase table."""
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("supabase_url and supabase_key required")

        url = f"{self.supabase_url}/rest/v1/{self.table_name}"
        payload = self._serialize_result(result)
        return self._post(url, payload)

    def send(self, result: ConsensusResult) -> bool:
        """Auto-route: Supabase if configured, else endpoint."""
        if self.supabase_url and self.supabase_key:
            return self.send_to_supabase(result)
        elif self.endpoint_url:
            return self.send_to_endpoint(result)
        else:
            raise ValueError("No backend configured (supabase or endpoint)")

    def get_stats(self) -> dict:
        return dict(self._stats)


class FileBridge:
    """Fallback bridge: write consensus results to local JSONL file.
    Useful for offline mode or when backend is unreachable."""

    def __init__(self, filepath: str = "./rq_consensus_log.jsonl"):
        self.filepath = filepath
        self._count = 0

    def send(self, result: ConsensusResult) -> bool:
        try:
            with open(self.filepath, "a") as f:
                line = json.dumps({
                    "round_id": result.round_id,
                    "timestamp": result.timestamp,
                    "agreement_score": result.agreement_score,
                    "participating_nodes": result.participating_nodes,
                    "metadata": result.metadata
                })
                f.write(line + "\n")
            self._count += 1
            return True
        except Exception:
            return False

    def get_stats(self) -> dict:
        return {"written": self._count, "filepath": self.filepath}
