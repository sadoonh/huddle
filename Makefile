SHELL := /bin/bash
BACKEND := backend
FRONTEND := frontend

.PHONY: help start setup backend-install frontend-install seed api web test backend-test backend-lint frontend-check lint build db-upgrade db-revision docker-up docker-down clean

help:
	@echo "start            one command: install deps, seed, run API + web"
	@echo "setup            install backend + frontend dependencies"
	@echo "seed             reset and seed the local demo workspace"
	@echo "api              run FastAPI on :8000"
	@echo "web              run Vite on :5173"
	@echo "test             backend tests + frontend typecheck/build"
	@echo "lint             ruff + frontend typecheck"
	@echo "build            production frontend build"
	@echo "db-upgrade       apply Alembic migrations"
	@echo "db-revision      autogenerate a migration (m=\"message\")"
	@echo "docker-up        full stack in docker-compose (:8080)"
	@echo "docker-down      stop the compose stack"

start:
	@./start.sh

setup: backend-install frontend-install

backend-install:
	cd $(BACKEND) && uv venv .venv --python 3.10 && uv pip install --python .venv/bin/python -r requirements-dev.txt

frontend-install:
	cd $(FRONTEND) && npm ci

seed:
	cd $(BACKEND) && .venv/bin/python -m app.seed --reset

api:
	cd $(BACKEND) && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

web:
	cd $(FRONTEND) && npm run dev

backend-test:
	cd $(BACKEND) && .venv/bin/python -m pytest

backend-lint:
	cd $(BACKEND) && .venv/bin/ruff check app tests

frontend-check:
	cd $(FRONTEND) && npm run typecheck && npm run build

test: backend-test frontend-check

lint: backend-lint frontend-check

build:
	cd $(FRONTEND) && npm run build

db-upgrade:
	cd $(BACKEND) && .venv/bin/alembic upgrade head

db-revision:
	cd $(BACKEND) && .venv/bin/alembic revision --autogenerate -m "$(m)"

docker-up:
	docker compose up --build

docker-down:
	docker compose down

clean:
	rm -rf $(FRONTEND)/dist $(BACKEND)/.pytest_cache $(BACKEND)/.ruff_cache
