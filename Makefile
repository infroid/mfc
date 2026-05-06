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
        sync-images migrate-image-urls \
        list-users set-role drop-schema reset serve

help: ## list all targets
	@echo "MyFoodCraving — make targets:"
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk -F':.*?## ' '{ printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }'

# ───── Python tooling (mfc CLI in automation/) ────────────────────────────

sync: ## sync the python venv (reinstalls all packages — safe across layout moves)
	@$(UV) sync --reinstall
	@# macOS sets the 'hidden' flag on newly-created files inside ~/Documents
	@# (iCloud sync behaviour). Python's site.py skips .pth files with that
	@# flag, which breaks the editable install of mfc. Strip it here.
	@find automation/.venv/lib -name '*.pth' -exec chflags nohidden {} + 2>/dev/null || true

status: ## list public tables and row counts
	@$(UV) run mfc status

apply-schema: ## run automation/db/schema.sql
	@$(UV) run mfc apply-schema

seed-metrics: ## run automation/db/seed_metrics.sql (54-marker catalog)
	@$(UV) run mfc seed-metrics

import-recipes: ## upsert ingredients, utensils, and recipes from web/assets/recipes/
	@$(UV) run mfc import-recipes

sync-images: ## sync recipe images bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-images --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Storage → local. Downloads Storage-only files; overwrites local where Storage is newer.\n"; \
	  printf "  push — local → Storage. Uploads local-only files; overwrites remote where local is newer.\n"; \
	  printf "  both — pull then push. Last-modified wins per file. Safe when no concurrent edits.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-images --direction $$d; \
	fi

migrate-image-urls: ## one-shot — rewrite recipe rows to use full Storage URLs (idempotent)
	@$(UV) run mfc migrate-image-urls

list-users: ## list users; optional ROLE=user|chef|admin Q=alice
	@$(UV) run mfc list-users $(if $(ROLE),--role $(ROLE)) $(if $(Q),--q $(Q))

set-role: ## change role; required USER=<email-or-uuid> ROLE=<user|chef|admin>
	@$(UV) run mfc set-role --user "$(USER)" --role "$(ROLE)"

drop-schema: ## DESTRUCTIVE — drop all public tables (prompts to confirm)
	@$(UV) run mfc drop-schema

reset: ## DESTRUCTIVE — rebuild venv + drop + apply + seed + import (one-shot reset)
	@echo "  · clearing automation/.venv and __pycache__ caches"
	@rm -rf automation/.venv
	@find automation/mfc -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	@$(UV) sync
	@$(UV) run mfc reset

# ───── Local dev server ───────────────────────────────────────────────────

serve: ## run the static site at http://localhost:8080 (serves web/)
	@cd web && python3 -m http.server 8080
