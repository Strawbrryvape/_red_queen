# rq_consensus_engine.py — Red Queen v2 Trimodal Consensus Engine
# Computes convergence between N model nodes using vector similarity metrics.

import math
import time
import asyncio
from typing import Dict, List, Tuple, Optional, Callable
from dataclasses import dataclass, field
from collections import defaultdict

from rq_vector_mesh import DIM


@dataclass
class NodeState:
    """Latest known state from a peer node."""
    node_id: str
    vector: List[float]
    seq: int
    timestamp: float
    received_at: float = field(default_factory=time.time)

    @property
    def age(self) -> float:
        return time.time() - self.received_at


@dataclass  
class ConsensusResult:
    """Output of a consensus round."""
    round_id: str
    timestamp: float
    consensus_vector: List[float]
    participating_nodes: List[str]
    agreement_score: float        # 0.0 - 1.0 (1.0 = perfect agreement)
    convergence_time_ms: float    # time from first to last packet in round
    raw_vectors: Dict[str, List[float]]
    metadata: Dict = field(default_factory=dict)


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors. Range: [-1, 1]."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def euclidean_distance(a: List[float], b: List[float]) -> float:
    """L2 distance between vectors."""
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def weighted_average(vectors: List[List[float]], weights: List[float]) -> List[float]:
    """Compute weighted mean of vectors."""
    assert len(vectors) == len(weights)
    assert len(vectors) > 0

    total_weight = sum(weights)
    if total_weight == 0:
        return vectors[0]

    dim = len(vectors[0])
    result = [0.0] * dim
    for vec, w in zip(vectors, weights):
        for i in range(dim):
            result[i] += vec[i] * w / total_weight
    return result


class ConsensusEngine:
    """Red Queen consensus engine.

    Algorithm:
    1. Collect vectors from all participating nodes within a round window
    2. Compute pairwise cosine similarity matrix
    3. Identify outlier nodes (similarity < threshold to majority)
    4. Weight remaining nodes by their average similarity to the group
    5. Produce consensus vector as weighted average
    6. Agreement score = mean similarity of included nodes
    """

    def __init__(
        self,
        expected_nodes: List[str] = None,
        round_window: float = 2.0,        # seconds to wait for all nodes
        similarity_threshold: float = 0.7, # min cosine similarity to be included
        min_nodes: int = 2,              # minimum nodes for valid consensus
        max_rounds: int = 1000           # backpressure limit
    ):
        self.expected_nodes = set(expected_nodes) if expected_nodes else set()
        self.round_window = round_window
        self.similarity_threshold = similarity_threshold
        self.min_nodes = min_nodes
        self.max_rounds = max_rounds

        self._states: Dict[str, NodeState] = {}
        self._round_counter = 0
        self._lock = asyncio.Lock()
        self._results_queue: asyncio.Queue = asyncio.Queue()

        # Callbacks
        self.on_consensus: Optional[Callable[[ConsensusResult], None]] = None

        # Metrics
        self.rounds_completed = 0
        self.rounds_failed = 0
        self.total_nodes_seen = set()

    def ingest(self, node_id: str, vector: List[float], seq: int, timestamp: float):
        """Feed a new vector from the mesh into the engine."""
        self._states[node_id] = NodeState(
            node_id=node_id,
            vector=vector,
            seq=seq,
            timestamp=timestamp
        )
        self.total_nodes_seen.add(node_id)

    async def run_round(self) -> Optional[ConsensusResult]:
        """Execute one consensus round. Blocks until window expires or all nodes report.
        Returns ConsensusResult or None if insufficient nodes."""

        async with self._lock:
            self._round_counter += 1
            round_id = f"rq-{self._round_counter:06d}-{int(time.time() * 1000) % 10000}"

            # Snapshot current states at start of round
            start_time = time.time()
            baseline = dict(self._states)

            # Wait for round window or all expected nodes
            while (time.time() - start_time) < self.round_window:
                current_nodes = set(self._states.keys())
                if self.expected_nodes and current_nodes >= self.expected_nodes:
                    break
                await asyncio.sleep(0.05)

            # Collect all states that arrived during/after our snapshot
            round_states = {
                nid: state for nid, state in self._states.items()
                if state.received_at >= start_time - self.round_window
            }

            if len(round_states) < self.min_nodes:
                self.rounds_failed += 1
                return None

            # Build similarity matrix
            nodes = list(round_states.keys())
            vectors = [round_states[n].vector for n in nodes]
            n = len(nodes)

            sim_matrix = [[0.0] * n for _ in range(n)]
            for i in range(n):
                for j in range(i, n):
                    sim = cosine_similarity(vectors[i], vectors[j])
                    sim_matrix[i][j] = sim
                    sim_matrix[j][i] = sim

            # Identify outliers: nodes with avg similarity below threshold
            included = []
            excluded = []
            weights = []

            for i, node in enumerate(nodes):
                # Average similarity to all other nodes
                others = [sim_matrix[i][j] for j in range(n) if j != i]
                avg_sim = sum(others) / len(others) if others else 0.0

                if avg_sim >= self.similarity_threshold:
                    included.append(node)
                    weights.append(avg_sim)
                else:
                    excluded.append(node)

            # Fallback: if everyone is an outlier, include all with equal weight
            if not included and len(nodes) >= self.min_nodes:
                included = nodes
                weights = [1.0 / n] * n

            if not included:
                self.rounds_failed += 1
                return None

            # Compute consensus vector
            included_vectors = [round_states[n].vector for n in included]
            consensus_vec = weighted_average(included_vectors, weights)

            # Agreement score = mean of upper-triangle similarities among included
            included_indices = [nodes.index(n) for n in included]
            agreements = []
            for i in included_indices:
                for j in included_indices:
                    if i < j:
                        agreements.append(sim_matrix[i][j])

            agreement_score = sum(agreements) / len(agreements) if agreements else 0.0

            # Convergence time
            times = [round_states[n].received_at for n in included]
            convergence_time = (max(times) - min(times)) * 1000 if len(times) > 1 else 0.0

            result = ConsensusResult(
                round_id=round_id,
                timestamp=time.time(),
                consensus_vector=consensus_vec,
                participating_nodes=included,
                agreement_score=agreement_score,
                convergence_time_ms=convergence_time,
                raw_vectors={n: round_states[n].vector for n in included},
                metadata={
                    "excluded_nodes": excluded,
                    "total_nodes_in_round": n,
                    "similarity_threshold": self.similarity_threshold,
                    "round_window": self.round_window
                }
            )

            self.rounds_completed += 1

            if self.on_consensus:
                try:
                    self.on_consensus(result)
                except Exception:
                    pass

            return result

    async def run_continuous(self, interval: float = 5.0):
        """Run consensus rounds continuously."""
        while True:
            result = await self.run_round()
            if result:
                await self._results_queue.put(result)
            await asyncio.sleep(interval)

    async def get_result(self) -> ConsensusResult:
        """Block until next consensus result is available."""
        return await self._results_queue.get()

    def get_metrics(self) -> dict:
        return {
            "rounds_completed": self.rounds_completed,
            "rounds_failed": self.rounds_failed,
            "total_nodes_seen": len(self.total_nodes_seen),
            "expected_nodes": list(self.expected_nodes),
            "current_states": {k: {"age": v.age, "seq": v.seq} for k, v in self._states.items()}
        }

    def reset(self):
        """Clear all state."""
        self._states.clear()
        self._round_counter = 0
