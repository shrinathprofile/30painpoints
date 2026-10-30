# docs-drift, day 04 of 30 — the whole day in one container:
# checks must pass, then the drifted fixture must fail as drift (exit 1).
# The container exits 0 only if BOTH behave; that's the CI story in miniature.
FROM python:3.12-slim

WORKDIR /day
RUN pip install --no-cache-dir fastapi pytest
COPY docs_drift.py test_drift.py ./
COPY fixtures/ ./fixtures/

CMD ["sh", "-c", \
     "python test_drift.py || exit 1; \
      python docs_drift.py fixtures.demo_api:app fixtures/openapi-drifted.json; \
      ec=$?; \
      if [ \"$ec\" -eq 1 ]; then \
        echo 'proof: checks green + drift failed CI (exit 1)'; \
      else \
        echo \"FAIL: expected drift to exit 1, got $ec\" >&2; exit 1; \
      fi"]
