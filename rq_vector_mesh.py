# rq_vector_mesh.py — Red Queen v2 Intermodel UDP Vector Mesh
# Status: Production-ready transport layer with HMAC authentication
# Zero dependencies beyond Python standard library

import asyncio
import socket
import struct
import hashlib
import hmac
import secrets
import time
from typing import List, Tuple, Optional, Callable

DIM = 384
MAX_PACKET = 2048  # MTU-safe with headroom
PROTOCOL_VERSION = 2

class MeshSecurity:
    """HMAC-SHA256 packet authentication. Shared secret must be distributed
    out-of-band (Docker secret, env var, or mounted file)."""

    def __init__(self, secret: bytes = None):
        self.secret = secret or secrets.token_bytes(32)
        self._digest_size = 32

    def sign(self, payload: bytes) -> bytes:
        """Returns 32-byte HMAC signature."""
        return hmac.new(self.secret, payload, hashlib.sha256).digest()

    def verify(self, payload: bytes, signature: bytes) -> bool:
        """Constant-time comparison to prevent timing attacks."""
        expected = self.sign(payload)
        return hmac.compare_digest(expected, signature)

    @classmethod
    def from_env(cls, env_var: str = "RQ_MESH_SECRET") -> "MeshSecurity":
        import os
        secret = os.environ.get(env_var, "").encode()
        if len(secret) < 16:
            raise RuntimeError(f"{env_var} must be at least 16 bytes")
        return cls(secret)


def _pack(node_id: str, vec: List[float], seq: int = 0, timestamp: float = None) -> bytes:
    """Pack a vector into a wire-format packet.

    Format: [version:1][seq:4][timestamp:8][nid_len:1][nid:n][vector:1536b]
    Total: 14 + n + 1536 bytes (max ~1.8KB for 255-byte node IDs)
    """
    ts = timestamp or time.time()
    nid = node_id.encode()[:255]
    return struct.pack(
        f"!BIIdB{len(nid)}s{DIM}f",
        PROTOCOL_VERSION,      # 1 byte
        seq & 0xFFFFFFFF,      # 4 bytes
        int(ts),               # 4 bytes (seconds since epoch)
        ts - int(ts),          # 8 bytes (fractional part)
        len(nid),              # 1 byte
        nid,                   # n bytes
        *vec                   # 1536 bytes (384 * 4)
    )


def _unpack(data: bytes) -> Optional[Tuple[str, List[float], int, float]]:
    """Unpack wire-format packet. Returns (node_id, vector, seq, timestamp) or None."""
    try:
        if len(data) < 15 or data[0] != PROTOCOL_VERSION:
            return None

        version, seq, ts_int, ts_frac, nid_len = struct.unpack("!BIIdB", data[:18])
        nid = data[18:18+nid_len].decode()
        vec = struct.unpack(f"!{DIM}f", data[18+nid_len:18+nid_len+DIM*4])
        return nid, list(vec), seq, ts_int + ts_frac
    except (struct.error, UnicodeDecodeError, IndexError):
        return None


class VectorMeshNode:
    """Async UDP broadcast node for sharing 384-dimensional latent vectors
    within an isolated Docker subnet."""

    def __init__(
        self,
        node_id: str,
        port: int = 47777,
        subnet_bcast: str = "172.18.255.255",
        security: MeshSecurity = None,
        max_queue: int = 1000,
        dedup_window: float = 5.0  # seconds
    ):
        self.node_id = node_id
        self.port = port
        self.bcast = subnet_bcast
        self.security = security
        self.max_queue = max_queue
        self.dedup_window = dedup_window

        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max_queue)
        self._seq = 0
        self._seen: dict = {}  # node_id -> (seq, timestamp) for dedup
        self._tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._tx.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self._tx.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

        # Metrics
        self.packets_tx = 0
        self.packets_rx = 0
        self.packets_dropped = 0
        self.packets_malformed = 0

    def broadcast(self, vector_state: List[float]) -> int:
        """Broadcast vector to mesh. Returns bytes sent."""
        assert len(vector_state) == DIM, f"Vector must be {DIM}d, got {len(vector_state)}"

        self._seq = (self._seq + 1) & 0xFFFFFFFF
        payload = _pack(self.node_id, vector_state, self._seq)

        if self.security:
            sig = self.security.sign(payload)
            packet = sig + payload
        else:
            packet = payload

        sent = self._tx.sendto(packet, (self.bcast, self.port))
        self.packets_tx += 1
        return sent

    async def listen(self):
        """Start the UDP listener. Must be awaited before ingest()."""
        loop = asyncio.get_running_loop()

        class _Protocol(asyncio.DatagramProtocol):
            def __init__(proto_self):
                super().__init__()
                proto_self.transport = None

            def datagram_received(proto_self, data, addr):
                self._handle_packet(data, addr)

            def error_received(proto_self, exc):
                pass

            def connection_lost(proto_self, exc):
                pass

        transport, _ = await loop.create_datagram_endpoint(
            _Protocol,
            local_addr=("0.0.0.0", self.port),
            reuse_port=True
        )
        self._transport = transport

    def _handle_packet(self, data: bytes, addr):
        """Internal packet handler with auth, dedup, and validation."""
        try:
            # Auth check
            if self.security:
                if len(data) < 32:
                    self.packets_malformed += 1
                    return
                sig, payload = data[:32], data[32:]
                if not self.security.verify(payload, sig):
                    self.packets_malformed += 1
                    return
            else:
                payload = data

            # Unpack
            result = _unpack(payload)
            if result is None:
                self.packets_malformed += 1
                return

            nid, vec, seq, ts = result

            # Ignore self
            if nid == self.node_id:
                return

            # Dedup: drop old or duplicate sequences
            now = time.time()
            if nid in self._seen:
                last_seq, last_ts = self._seen[nid]
                if seq <= last_seq or (now - last_ts) > self.dedup_window * 2:
                    self.packets_dropped += 1
                    return

            self._seen[nid] = (seq, now)

            # Queue with backpressure
            try:
                self.queue.put_nowait((nid, vec, addr, seq, ts))
                self.packets_rx += 1
            except asyncio.QueueFull:
                self.packets_dropped += 1

        except Exception:
            self.packets_malformed += 1

    async def ingest(self):
        """Async generator — yields (node_id, vector, addr, seq, timestamp).

        Usage:
            async for nid, vec, addr, seq, ts in mesh.ingest():
                consensus_engine.ingest(nid, vec)
        """
        while True:
            yield await self.queue.get()

    def get_metrics(self) -> dict:
        """Return current mesh metrics."""
        return {
            "node_id": self.node_id,
            "packets_tx": self.packets_tx,
            "packets_rx": self.packets_rx,
            "packets_dropped": self.packets_dropped,
            "packets_malformed": self.packets_malformed,
            "queue_size": self.queue.qsize(),
            "seen_peers": len(self._seen)
        }

    def close(self):
        """Clean shutdown."""
        self._tx.close()
        if hasattr(self, '_transport'):
            self._transport.close()


# ===== Convenience factory =====
def create_mesh_node(
    node_id: str,
    subnet_bcast: str = "172.18.255.255",
    enable_auth: bool = True
) -> VectorMeshNode:
    """Factory with sensible defaults for Docker deployment."""
    security = MeshSecurity.from_env() if enable_auth else None
    return VectorMeshNode(
        node_id=node_id,
        subnet_bcast=subnet_bcast,
        security=security
    )
