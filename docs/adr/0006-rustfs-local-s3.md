# 0006 RustFS instead of MinIO for local object storage

Status: accepted (WS-00, 2026-10-15)

## Context
ARCHITECTURE §1 planned MinIO as the local S3-compatible store. MinIO no longer publishes community images: on 2026-10-15 `docker.io/minio/minio` and `minio/mc` returned "repository does not exist", and `quay.io/minio/minio` required authentication.

## Decision
Use **RustFS 1.0.1** (`rustfs/rustfs:1.0.1`, Apache-2.0, S3 API) as the compose service `s3`. A one-shot `amazon/aws-cli:2.38.1` container creates the bucket `ie-ledger-statements` and turns on default server-side encryption (AES256). Both steps were checked against the running service.

The app talks plain S3 with an endpoint URL, so nothing outside `docker-compose.yml` depends on which server runs locally.

## Alternatives
- An old, still-cached MinIO tag: not reproducible on a clean machine.
- SeaweedFS: mature, but more setup for a single bucket.
- LocalStack: heavier, and S3 is all that is needed.

## Consequences
Local credentials and endpoint: `http://localhost:9000`, key `ie_ledger`, secret `ie_ledger_secret`. Production storage is chosen with hosting (SPEC Q4).
