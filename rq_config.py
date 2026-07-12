# rq_config.py — Red Queen v2 Configuration
# Environment-driven configuration with sensible defaults.

import os
from typing import List, Optional
from dataclasses import dataclass, field


@dataclass
class RQConfig:
    """Red Queen v2 node configuration."""

    # Identity
    node_id: str = "rq-node-1"

    # Mesh
    mesh_port: int = 47777
    mesh_bcast: str = "172.18.255.255"
    mesh_auth: bool = True

    # Consensus
    expected_nodes: List[str] = field(default_factory=list)
    round_window: float = 2.0
    round_interval: float = 5.0
    similarity_threshold: float = 0.7
    min_nodes: int = 2

    # Bridge
    supabase_url: str = None
    supabase_key: str = None
    supabase_table: str = "rq_consensus_log"
    endpoint_url: str = None
    endpoint_key: str = None

    # Logging
    log_dir: str = "./rq_logs"
    metrics_interval: float = 30.0

    @classmethod
    def from_env(cls) -> "RQConfig":
        """Load configuration from environment variables."""

        # Parse expected nodes from comma-separated string
        nodes_str = os.environ.get("RQ_EXPECTED_NODES", "")
        expected_nodes = [n.strip() for n in nodes_str.split(",") if n.strip()]

        return cls(
            node_id=os.environ.get("RQ_NODE_ID", "rq-node-1"),
            mesh_port=int(os.environ.get("RQ_MESH_PORT", "47777")),
            mesh_bcast=os.environ.get("RQ_MESH_BCAST", "172.18.255.255"),
            mesh_auth=os.environ.get("RQ_MESH_AUTH", "true").lower() == "true",
            expected_nodes=expected_nodes,
            round_window=float(os.environ.get("RQ_ROUND_WINDOW", "2.0")),
            round_interval=float(os.environ.get("RQ_ROUND_INTERVAL", "5.0")),
            similarity_threshold=float(os.environ.get("RQ_SIM_THRESHOLD", "0.7")),
            min_nodes=int(os.environ.get("RQ_MIN_NODES", "2")),
            supabase_url=os.environ.get("SUPABASE_URL") or os.environ.get("RQ_SUPABASE_URL"),
            supabase_key=os.environ.get("SUPABASE_KEY") or os.environ.get("RQ_SUPABASE_KEY"),
            supabase_table=os.environ.get("RQ_SUPABASE_TABLE", "rq_consensus_log"),
            endpoint_url=os.environ.get("RQ_ENDPOINT_URL"),
            endpoint_key=os.environ.get("RQ_ENDPOINT_KEY"),
            log_dir=os.environ.get("RQ_LOG_DIR", "./rq_logs"),
            metrics_interval=float(os.environ.get("RQ_METRICS_INTERVAL", "30.0"))
        )

    def to_dict(self) -> dict:
        """Serialize to dict (for logging)."""
        return {
            "node_id": self.node_id,
            "mesh_port": self.mesh_port,
            "mesh_bcast": self.mesh_bcast,
            "mesh_auth": self.mesh_auth,
            "expected_nodes": self.expected_nodes,
            "round_window": self.round_window,
            "round_interval": self.round_interval,
            "similarity_threshold": self.similarity_threshold,
            "min_nodes": self.min_nodes,
            "supabase_url": self.supabase_url is not None,
            "supabase_table": self.supabase_table,
            "endpoint_url": self.endpoint_url is not None,
            "log_dir": self.log_dir,
            "metrics_interval": self.metrics_interval
        }
