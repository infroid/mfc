# MyFoodCraving — root Makefile
#
# Single entry point for every chore. The Python tool lives in `automation/`
# and is run via uv (auto-creates a venv from automation/pyproject.toml).
#
# Bootstrap (once):
#   brew install uv         # or: curl -LsSf https://astral.sh/uv/install.sh | sh
#   cp automation/.env.sample automation/.env  # then fill in keys
#   make sync
#
# Run `make` (or `make help`) to see all targets.

UV := uv --project automation

.DEFAULT_GOAL := help

.PHONY: help sync status apply-schema seed-metrics import-recipes \
        drop-schema reset serve

help: ## list all targets
	@echo "MyFoodCraving — make targets:"
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk -F':.*?## ' '{ printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }'

# ───── Python tooling (mfc CLI in automation/) ────────────────────────────

sync: ## sync the python venv (after editing automation/pyproject.toml)
	@$(UV) sync

status: ## list public tables and row counts
	@$(UV) run mfc status

apply-schema: ## run data/db/schema.sql
	@$(UV) run mfc apply-schema

seed-metrics: ## run data/db/seed_metrics.sql (54-marker catalog)
	@$(UV) run mfc seed-metrics

import-recipes: ## upsert ingredients, utensils, and recipes from data/recipe-bundles/
	@$(UV) run mfc import-recipes

drop-schema: ## DESTRUCTIVE — drop all public tables (prompts to confirm)
	@$(UV) run mfc drop-schema

reset: ## DESTRUCTIVE — drop + apply + seed + import (one-shot reset)
	@$(UV) run mfc reset

# ───── Local dev server ───────────────────────────────────────────────────

serve: ## run the static site at http://localhost:8080
	@python3 -m http.server 8080
