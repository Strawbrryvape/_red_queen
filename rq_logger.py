# rq_logger.py — Red Queen v2 Research Ledger Logger
# Structured JSONL logging for experimental reproducibility.

import json
import os
import time
from datetime import datetime
from typing import Any, Dict


class ResearchLogger:
    """Structured logger for Red Queen research experiments.

    Writes JSONL files with timestamped events. Each log line is a
    self-contained JSON object for easy parsing by analytics tools.

    Log format:
        {"ts": "2026-07-06T22:30:00.123456", "level": "info", "event": "node_start", "data": {...}}
    """

    LEVELS = {"debug": 10, "info": 20, "warning": 30, "error": 40, "critical": 50}

    def __init__(self, log_dir: str = "./rq_logs", node_id: str = "unknown", min_level: str = "info"):
        self.log_dir = log_dir
        self.node_id = node_id
        self.min_level = self.LEVELS.get(min_level, 20)

        os.makedirs(log_dir, exist_ok=True)

        # Rotate files by date
        self.date_str = datetime.now().strftime("%Y-%m-%d")
        self.log_file = os.path.join(log_dir, f"rq_{node_id}_{self.date_str}.jsonl")

        self._fh = open(self.log_file, "a")
        self._event_count = 0

    def _write(self, level: str, event: str, data: Dict[str, Any]):
        if self.LEVELS.get(level, 0) < self.min_level:
            return

        entry = {
            "ts": datetime.now().isoformat(),
            "level": level,
            "node_id": self.node_id,
            "event": event,
            "data": data
        }

        self._fh.write(json.dumps(entry) + "\n")
        self._fh.flush()
        self._event_count += 1

    def debug(self, event: str, data: Dict):
        self._write("debug", event, data)

    def info(self, event: str, data: Dict):
        self._write("info", event, data)

    def warning(self, event: str, data: Dict):
        self._write("warning", event, data)

    def error(self, event: str, data: Dict):
        self._write("error", event, data)

    def critical(self, event: str, data: Dict):
        self._write("critical", event, data)

    def log_experiment(self, experiment_id: str, hypothesis: str, params: Dict):
        """Log the start of a formal experiment."""
        self.info("experiment_start", {
            "experiment_id": experiment_id,
            "hypothesis": hypothesis,
            "parameters": params
        })

    def log_experiment_result(self, experiment_id: str, result: str, metrics: Dict):
        """Log the conclusion of an experiment."""
        self.info("experiment_end", {
            "experiment_id": experiment_id,
            "result": result,
            "metrics": metrics
        })

    def get_stats(self) -> dict:
        return {
            "log_file": self.log_file,
            "events_written": self._event_count,
            "log_dir": self.log_dir
        }

    def close(self):
        if self._fh:
            self._fh.close()
            self._fh = None
