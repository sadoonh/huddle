# Operations

## 1. Local development

```bash
make setup      # backend .venv + frontend node_modules
make seed       # demo analytics team (destructive: drops and rebuilds local tables)
make api        # http://localhost:8000, docs at /api/docs
make web        # http://localhost:5173
```

Local defaults use SQLite (`backend/standup.db`) and `AUTH_MODE=dev`. The identity switcher in the SPA is available only in dev mode.

Useful commands:

```bash
make backend-test
make backend-lint
make frontend-check
make db-upgrade
make db-revision m="add table x"
```

### Docker

```bash
make docker-up    # Postgres 16 + API + nginx SPA at http://localhost:8080
make docker-down
```

The compose API command applies Alembic migrations and runs `python -m app.seed` (idempotent) before starting uvicorn.

---

## 2. Configuration

Backend settings are environment variables (see `backend/.env.example`).

| Variable | Default | Notes |
|---|---|---|
| `ENVIRONMENT` | `local` | `dev` mode refuses non-local environments |
| `DATABASE_URL` | `sqlite:///./standup.db` | use `postgresql+psycopg://…` in deployment |
| `AUTH_MODE` | `dev` | `nex` trusts SSO headers |
| `DEV_DEFAULT_USER_EMAIL` | `manager@nex.local` | default dev identity |
| `CORS_ORIGINS` | `http://localhost:5173` | comma-separated |
| `API_PREFIX` | `/api/v1` | |
| `AI_PROVIDER` | `mock` | `mock` or `bedrock` |
| `AI_PROCESSING_INLINE` | `true` | false → SQS worker |
| `SQS_QUEUE_URL` | empty | worker queue; set by Terraform |
| `BEDROCK_REGION` / `BEDROCK_MODEL_ID` | `us-east-1` / Claude 3.5 Sonnet | |
| `TRANSCRIPT_BUCKET` | empty | empty → local filesystem |
| `TRANSCRIPT_LOCAL_DIR` | `.transcripts` | dev fallback |
| `MAX_TRANSCRIPT_BYTES` | 2 MB | upload limit |
| `UPCOMING_DUE_DAYS` | 3 | “active” due-date window |
| `AUTO_INIT_DB` | false | production must use Alembic |

Frontend: `VITE_API_BASE` (default `/api/v1`).

---

## 3. Database migrations

Alembic is the schema authority.

```bash
cd backend
.venv/bin/alembic upgrade head
.venv/bin/alembic revision --autogenerate -m "describe change"
.venv/bin/alembic check     # CI: detect model/migration drift
```

Production rollout order:

1. Apply the migration from a network-connected runner/bastion (or a one-off migration task).
2. Deploy the new Lambda image.
3. Verify `/health/ready` and key flows.

The API does **not** run migrations on startup. `AUTO_INIT_DB` is false; creating tables via `create_all` is limited to SQLite local/test.

### Running migrations against RDS

RDS is private. Options:

- Run `alembic upgrade head` from a CI runner attached to the VPC (preferred).
- Run it from a bastion/ECS task in the same VPC.
- Temporarily allow your IP in the RDS security group (not recommended).

Never commit credentials. Use a secret manager or CI-protected variables.

---

## 4. Deployment

### 4.1 Infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill VPC, subnets, password, origin
terraform init
terraform apply
```

This creates:

- VPC-attached RDS PostgreSQL (`db.t4g.micro` by default, encrypted, 7-day backups).
- S3 transcript bucket (public access blocked, versioned, AES256, lifecycle expiry).
- ECR repository for the backend image.
- API Lambda + transcript worker Lambda (same image, different command).
- SQS queue + DLQ, event source mapping capped at concurrency 2.
- HTTP API Gateway with a `$default` proxy route.
- CloudWatch log groups plus Lambda error and RDS CPU alarms.

The reference stack assumes the existing nex VPC provides outbound access (NAT) or VPC endpoints for S3, SQS and Bedrock. If it does not, add interface/gateway endpoints before enabling transcript upload.

### 4.2 Image

```bash
API_IMAGE=$(terraform -chdir=infra/terraform output -raw ecr_repository_url):release-$(date -u +%Y%m%dT%H%M%SZ)
docker build --platform linux/amd64 -t "$API_IMAGE" backend
docker push "$API_IMAGE"
```

Set `api_image_uri` to that immutable tag and apply Terraform again. Both Lambdas use the same image; the worker overrides the command to `app.worker.handler`.

### 4.3 Frontend

```bash
cd frontend
VITE_API_BASE=https://<api-id>.execute-api.<region>.amazonaws.com/api/v1 npm run build
```

Publish `dist/` through the nex portal. If the SPA is same-origin with the API, leave `VITE_API_BASE=/api/v1`.

### 4.4 AI

- Leave `AI_PROVIDER=mock` until extraction quality is validated with authorized sample transcripts.
- Switch to `bedrock` and verify the model is enabled in the account/region.
- Keep `AI_PROCESSING_INLINE=false` in deployed environments; the API enqueues and the worker processes.
- If a job fails three times it lands in the DLQ; inspect the worker logs and reprocess the transcript.

---

## 5. RDS and Lambda connection management

The API Lambda opens a SQLAlchemy pool per execution environment. For a small team this is acceptable:

- `pool_size=5`, `max_overflow=5`, `pool_pre_ping=True`, `pool_recycle=300`.
- Keep Lambda concurrency bounded (reserved concurrency) before growth.
- If concurrency or connection errors appear (`too many connections`), introduce **RDS Proxy** — it is deliberately not part of the first MVP to avoid unnecessary infrastructure.

Worker concurrency is capped at 2, batch size 1, so transcript jobs do not exhaust the DB pool.

---

## 6. Observability

- **Logs:** structured uvicorn/FastAPI logs in `/aws/lambda/nex-standup-<env>-api` and `-worker`. Request validation and domain errors are logged at WARN; unexpected DB errors at ERROR with stack traces.
- **Alarms:** API Lambda `Errors >= 1` per 5 minutes and RDS CPU > 80% for 10 minutes. Wire `alarm_actions` to the team SNS topic.
- **DLQ:** `nex-standup-<env>-transcripts-dlq`. Alert on `ApproximateNumberOfMessagesVisible > 0`.
- **Health:** `/health` (liveness) and `/health/ready` (DB `SELECT 1`).
- **Audit:** every mutation is queryable via `/api/v1/audit`; AI proposal failures include `failure_reason`.

Recommended additional alarms for production: Lambda p95 duration, RDS free storage, RDS connections, API Gateway 5xx rate.

---

## 7. Backup and recovery

- RDS automated backups: 7 days by default (`backup_retention_period = 7`). Increase for production.
- Deletion protection is enabled when `environment = "prod"`; final snapshots are taken in prod.
- S3 transcripts are versioned; lifecycle expiration follows `transcript_retention_days` (default 90).
- Audit and historical rows are retained with the database backup; they are append-only in the application.
- Restore procedure: restore the RDS snapshot to a new instance, point `DATABASE_URL` at it via a new Lambda version, verify `/health/ready` and audit counts before cutover.

---

## 8. Transcript data governance

Transcripts can contain sensitive customer or employee information.

- Only authorized managers can upload; the S3 bucket blocks public access and is encrypted.
- Retention is enforced by S3 lifecycle (`transcript_retention_days`). Align it with company policy.
- Transcript text is also stored in PostgreSQL for evidence and duplicate detection; the database backup retention therefore matters.
- S3 access is limited to the Lambda execution role.
- Before enabling Bedrock in production, confirm the approved model/region, data-processing terms and whether transcript content may leave the VPC/region.
- The AI can propose changes but cannot apply them; reviewer identity and timestamps are audited.

---

## 9. Runbooks

### Transcript stuck in `uploaded`

1. Check SQS queue depth and worker Lambda errors.
2. Verify the worker has VPC access to SQS, S3, Bedrock and RDS (NAT/endpoints/security groups).
3. If the worker is unavailable, use `POST /ai/transcripts/{id}/reprocess` (runs inline in the API process) or re-drive the SQS message.
4. Check `transcripts.error` and the `transcript.failed` audit event.

### AI proposal apply returns 409

Expected when the task changed after proposal generation. The proposal is persisted as `failed`; the task keeps the newer state. Re-evaluate:

- Edit the proposal payload and approve it again (requires a fresh proposal/version), or
- Reject/close it, or
- Reprocess the transcript against current task state.

Never bypass the check by editing the task's stored version.

### Duplicate standup session

`409` includes `details.session_id`. Open the existing session instead. There is intentionally one session per date.

### “Too many connections” from RDS

1. Bound API Lambda reserved concurrency.
2. Reduce `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`.
3. Introduce RDS Proxy.
4. Check for a runaway worker (concurrency cap is 2).

### Employee cannot submit a pre-meeting update

- Session may be completed → closed.
- The employee may already be reviewed → closed.
- The user may not be a participant.
- The update is self-only (admin can override).

### Task edit returns 409

The SPA shows the current version. Refresh and re-apply. This is intentional protection against overwriting another manager's change.

---

## 10. Security checklist before production

- [ ] `AUTH_MODE=nex`; no dev identity path reachable.
- [ ] The nex gateway strips inbound `X-Nex-*` headers.
- [ ] CORS origins restricted to the nex portal.
- [ ] Database password in Secrets Manager, not Terraform state/plain variables.
- [ ] RDS not publicly accessible; security group only allows the Lambda SG.
- [ ] S3 bucket public access blocked; lifecycle retention approved.
- [ ] Bedrock model/region approved for transcript data.
- [ ] CloudWatch alarms wired to the on-call SNS topic.
- [ ] DLQ alarm configured.
- [ ] Backups, restore drill and retention confirmed.
- [ ] Admin role assignment process documented.
- [ ] Audit access reviewed (managers see the full trail).
