# Shortcuts for the Docker Compose stack (see docs/operations/deployment.md).

ifneq ($(wildcard .env),)
include .env
endif
BIND_ADDRESS ?= 127.0.0.1
PORT ?= 8080
export BIND_ADDRESS PORT
URL := http://$(if $(filter 0.0.0.0,$(BIND_ADDRESS)),127.0.0.1,$(BIND_ADDRESS)):$(PORT)

.DEFAULT_GOAL := help
.PHONY: help up down restart build logs ps check

help: ## Show available targets
	@grep -hE '^[a-z]+:.*## ' Makefile | awk 'BEGIN {FS = ":.*## "} {printf "  make %-8s %s\n", $$1, $$2}'

up: ## Build and start the stack, wait until healthy
	@test -f .env || cp .env.example .env
	docker compose up -d --build --wait
	@$(MAKE) --no-print-directory check
	@echo "App: $(URL)"

down: ## Stop the stack (data volume is kept)
	docker compose down

restart: ## Restart both containers without rebuilding
	docker compose restart

build: ## Build the images without starting
	docker compose build

logs: ## Follow the logs of both containers
	docker compose logs -f

ps: ## Show container status
	docker compose ps

check: ## Check health and readiness endpoints
	curl -fsS $(URL)/healthz && echo
	curl -fsS $(URL)/api/ready && echo
