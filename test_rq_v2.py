# test_rq_v2.py — Red Queen v2 Unit & Integration Tests
# Run: pytest test_rq_v2.py -v

import asyncio
import pytest
import math
import time

from rq_vector_mesh import _pack, _unpack, VectorMeshNode, MeshSecurity, DIM
from rq_consensus_engine import (
    cosine_similarity, euclidean_distance, weighted_average,
    ConsensusEngine, NodeState, ConsensusResult
)
from rq_config import RQConfig


class TestVectorPacking:
    """Test wire format serialization."""

    def test_pack_unpack_roundtrip(self):
        vec = [float(i) / 100.0 for i in range(DIM)]
        packet = _pack("test-node", vec, seq=42)
        result = _unpack(packet)

        assert result is not None
        nid, out_vec, seq, ts = result
        assert nid == "test-node"
        assert seq == 42
        assert len(out_vec) == DIM
        assert math.isclose(out_vec[0], 0.0, rel_tol=1e-5)
        assert math.isclose(out_vec[383], 3.83, rel_tol=1e-5)

    def test_unpack_malformed(self):
        assert _unpack(b"\x00\x01") is None  # wrong version
        assert _unpack(b"\x02") is None       # too short
        assert _unpack(b"\x02" + b"\x00" * 1000) is None  # wrong size


class TestMeshSecurity:
    """Test HMAC authentication."""

    def test_sign_verify(self):
        sec = MeshSecurity(secret=b"test-secret-key-1234")
        payload = b"hello world"
        sig = sec.sign(payload)
        assert len(sig) == 32
        assert sec.verify(payload, sig) is True
        assert sec.verify(payload, b"\x00" * 32) is False

    def test_from_env(self, monkeypatch):
        monkeypatch.setenv("RQ_MESH_SECRET", "a" * 32)
        sec = MeshSecurity.from_env()
        assert sec.secret == b"a" * 32


class TestSimilarityMetrics:
    """Test vector math utilities."""

    def test_cosine_identical(self):
        v = [1.0, 2.0, 3.0]
        assert math.isclose(cosine_similarity(v, v), 1.0, rel_tol=1e-6)

    def test_cosine_opposite(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert math.isclose(cosine_similarity(a, b), -1.0, rel_tol=1e-6)

    def test_cosine_orthogonal(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert math.isclose(cosine_similarity(a, b), 0.0, abs_tol=1e-6)

    def test_euclidean(self):
        a = [1.0, 2.0, 3.0]
        b = [4.0, 0.0, 3.0]
        assert math.isclose(euclidean_distance(a, b), math.sqrt(13), rel_tol=1e-6)

    def test_weighted_average(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        result = weighted_average([a, b], [1.0, 1.0])
        assert math.isclose(result[0], 0.5, rel_tol=1e-6)
        assert math.isclose(result[1], 0.5, rel_tol=1e-6)


class TestConsensusEngine:
    """Test consensus algorithm."""

    @pytest.mark.asyncio
    async def test_basic_consensus(self):
        engine = ConsensusEngine(
            expected_nodes=["a", "b"],
            round_window=0.1,
            similarity_threshold=0.5,
            min_nodes=2
        )

        # Two identical vectors should have perfect agreement
        vec = [0.1] * DIM
        engine.ingest("a", vec, seq=1, timestamp=time.time())
        engine.ingest("b", vec, seq=1, timestamp=time.time())

        result = await engine.run_round()
        assert result is not None
        assert result.agreement_score == 1.0
        assert len(result.participating_nodes) == 2

    @pytest.mark.asyncio
    async def test_outlier_exclusion(self):
        engine = ConsensusEngine(
            expected_nodes=["a", "b", "c"],
            round_window=0.1,
            similarity_threshold=0.9,  # High threshold
            min_nodes=2
        )

        # a and b agree, c is an outlier
        vec_ab = [0.1] * DIM
        vec_c = [-0.5] * DIM

        engine.ingest("a", vec_ab, seq=1, timestamp=time.time())
        engine.ingest("b", vec_ab, seq=1, timestamp=time.time())
        engine.ingest("c", vec_c, seq=1, timestamp=time.time())

        result = await engine.run_round()
        assert result is not None
        assert "c" not in result.participating_nodes
        assert result.agreement_score > 0.99

    @pytest.mark.asyncio
    async def test_insufficient_nodes(self):
        engine = ConsensusEngine(
            expected_nodes=["a", "b"],
            round_window=0.1,
            min_nodes=2
        )

        # Only one node reports
        engine.ingest("a", [0.1] * DIM, seq=1, timestamp=time.time())

        result = await engine.run_round()
        assert result is None
        assert engine.rounds_failed == 1


class TestRQConfig:
    """Test configuration loading."""

    def test_defaults(self):
        config = RQConfig()
        assert config.node_id == "rq-node-1"
        assert config.mesh_port == 47777
        assert config.similarity_threshold == 0.7

    def test_from_env(self, monkeypatch):
        monkeypatch.setenv("RQ_NODE_ID", "test-node")
        monkeypatch.setenv("RQ_EXPECTED_NODES", "a,b,c")
        monkeypatch.setenv("RQ_SIM_THRESHOLD", "0.85")

        config = RQConfig.from_env()
        assert config.node_id == "test-node"
        assert config.expected_nodes == ["a", "b", "c"]
        assert config.similarity_threshold == 0.85


class TestIntegration:
    """Integration tests with real UDP sockets (localhost only)."""

    @pytest.mark.asyncio
    async def test_mesh_broadcast_receive(self):
        """Two nodes on localhost (not broadcast, but tests the flow)."""
        node1 = VectorMeshNode("node-1", port=47778, subnet_bcast="127.0.0.1")
        node2 = VectorMeshNode("node-2", port=47778, subnet_bcast="127.0.0.1")

        await node1.listen()
        await node2.listen()

        vec = [0.01 * i for i in range(DIM)]
        node1.broadcast(vec)

        # Small delay for UDP
        await asyncio.sleep(0.1)

        # Check node2 received it
        assert node2.packets_rx == 1
        assert node2.queue.qsize() == 1

        nid, out_vec, addr, seq, ts = node2.queue.get_nowait()
        assert nid == "node-1"
        assert len(out_vec) == DIM

        node1.close()
        node2.close()
