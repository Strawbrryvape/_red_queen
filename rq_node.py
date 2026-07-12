# rq_node.py — Red Queen v2 Main Orchestrator Node
# Ties mesh + consensus + bridge into a single runnable unit.

import asyncio
import signal
import sys
import time
import os
from typing import Optional

from rq_vector_mesh import VectorMeshNode, MeshSecurity, create_mesh_node
from rq_consensus_engine import ConsensusEngine, ConsensusResult
from rq_bridge import ConsensusBridge, FileBridge
from rq_logger import ResearchLogger
from rq_config import RQConfig


class RedQueenNode:
    """Single Red Queen node. Runs mesh listener, consensus engine, and bridge
    in a coordinated event loop.

    Usage:
        config = RQConfig.from_env()
        node = RedQueenNode(config)
        await node.start()
        # Runs until SIGINT
        await node.stop()
    """

    def __init__(self, config: RQConfig):
        self.config = config
        self.mesh: Optional[VectorMeshNode] = None
        self.engine: Optional[ConsensusEngine] = None
        self.bridge: Optional[ConsensusBridge] = None
        self.file_bridge: Optional[FileBridge] = None
        self.logger: Optional[ResearchLogger] = None

        self._running = False
        self._tasks = []
        self._shutdown_event = asyncio.Event()

    async def start(self):
        """Initialize and start all subsystems."""
        print(f"[RQ] Starting Red Queen v2 node: {self.config.node_id}")

        # Initialize logger
        self.logger = ResearchLogger(
            log_dir=self.config.log_dir,
            node_id=self.config.node_id
        )
        self.logger.info("node_start", {"config": self.config.to_dict()})

        # Initialize mesh
        security = MeshSecurity.from_env() if self.config.mesh_auth else None
        self.mesh = VectorMeshNode(
            node_id=self.config.node_id,
            port=self.config.mesh_port,
            subnet_bcast=self.config.mesh_bcast,
            security=security
        )
        await self.mesh.listen()
        self.logger.info("mesh_listen", {"port": self.config.mesh_port})
        print(f"[RQ] Mesh listening on UDP {self.config.mesh_port}")

        # Initialize consensus engine
        self.engine = ConsensusEngine(
            expected_nodes=self.config.expected_nodes,
            round_window=self.config.round_window,
            similarity_threshold=self.config.similarity_threshold,
            min_nodes=self.config.min_nodes
        )
        self.engine.on_consensus = self._on_consensus
        self.logger.info("engine_init", {"expected_nodes": self.config.expected_nodes})

        # Initialize bridge
        if self.config.supabase_url:
            self.bridge = ConsensusBridge(
                supabase_url=self.config.supabase_url,
                supabase_key=self.config.supabase_key,
                table_name=self.config.supabase_table
            )
            self.logger.info("bridge_init", {"type": "supabase"})
        elif self.config.endpoint_url:
            self.bridge = ConsensusBridge(
                endpoint_url=self.config.endpoint_url,
                api_key=self.config.endpoint_key
            )
            self.logger.info("bridge_init", {"type": "endpoint"})

        # Always initialize file bridge as fallback
        self.file_bridge = FileBridge(filepath=f"{self.config.log_dir}/consensus_fallback.jsonl")

        # Start background tasks
        self._running = True
        self._tasks = [
            asyncio.create_task(self._mesh_ingest_loop()),
            asyncio.create_task(self._consensus_loop()),
            asyncio.create_task(self._metrics_loop())
        ]

        self.logger.info("node_ready", {})
        print(f"[RQ] Node ready. Expected peers: {self.config.expected_nodes}")

        # Wait for shutdown
        await self._shutdown_event.wait()

    async def _mesh_ingest_loop(self):
        """Background task: consume mesh packets and feed engine."""
        async for node_id, vec, addr, seq, ts in self.mesh.ingest():
            self.engine.ingest(node_id, vec, seq, ts)
            self.logger.debug("mesh_ingest", {
                "from": node_id,
                "addr": str(addr),
                "seq": seq
            })

    async def _consensus_loop(self):
        """Background task: run consensus rounds periodically."""
        while self._running:
            result = await self.engine.run_round()
            if result:
                self.logger.info("consensus_round", {
                    "round_id": result.round_id,
                    "agreement": result.agreement_score,
                    "nodes": result.participating_nodes,
                    "time_ms": result.convergence_time_ms
                })
                # Bridge will be called by on_consensus callback
            await asyncio.sleep(self.config.round_interval)

    def _on_consensus(self, result: ConsensusResult):
        """Callback: fired when consensus engine produces a result."""
        # Try primary bridge
        if self.bridge:
            try:
                success = self.bridge.send(result)
                if success:
                    self.logger.info("bridge_success", {"round_id": result.round_id})
                else:
                    self.logger.warning("bridge_fail", {"round_id": result.round_id})
                    # Fallback to file
                    self.file_bridge.send(result)
            except Exception as e:
                self.logger.error("bridge_error", {"error": str(e)})
                self.file_bridge.send(result)
        else:
            # No bridge configured, just log to file
            self.file_bridge.send(result)
            self.logger.info("bridge_file_only", {"round_id": result.round_id})

    async def _metrics_loop(self):
        """Background task: periodic metrics dump."""
        while self._running:
            await asyncio.sleep(self.config.metrics_interval)

            mesh_metrics = self.mesh.get_metrics()
            engine_metrics = self.engine.get_metrics()
            bridge_stats = self.bridge.get_stats() if self.bridge else {}

            self.logger.info("metrics", {
                "mesh": mesh_metrics,
                "engine": engine_metrics,
                "bridge": bridge_stats
            })

            print(f"[RQ] Metrics — TX:{mesh_metrics['packets_tx']} RX:{mesh_metrics['packets_rx']} "
                  f"Rounds:{engine_metrics['rounds_completed']} "
                  f"Peers:{mesh_metrics['seen_peers']}")

    async def stop(self):
        """Graceful shutdown."""
        print("[RQ] Shutting down...")
        self._running = False
        self._shutdown_event.set()

        for task in self._tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        if self.mesh:
            self.mesh.close()

        if self.logger:
            self.logger.info("node_stop", {})
            self.logger.close()

        print("[RQ] Shutdown complete.")

    def signal_handler(self, sig):
        """Register with asyncio for graceful shutdown on SIGINT/SIGTERM."""
        asyncio.create_task(self.stop())


# ===== CLI Entry Point =====
async def main():
    """CLI entry point."""
    config = RQConfig.from_env()
    node = RedQueenNode(config)

    # Setup signal handlers
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: node.signal_handler(s))

    try:
        await node.start()
    except Exception as e:
        print(f"[RQ] Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
