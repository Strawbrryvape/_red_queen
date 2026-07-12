FROM python:3.11-slim

WORKDIR /app

# Install only what's needed (stdlib-only, but keep curl for healthchecks)
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy orchestrator code
COPY orchestrator/ ./

# Create log directory
RUN mkdir -p /app/logs

# Run the Red Queen node
CMD ["python", "-u", "rq_node.py"]
