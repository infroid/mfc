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

.PHONY: help sync status apply-schema seed-metrics \
        sync-recipes sync-images sync-utensils create-utensil \
        list-users set-role suspend-user drop-schema reset serve

help: ## list all targets
	@echo "MyFoodCraving — make targets:"
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk -F':.*?## ' '{ printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }'

# ───── Python tooling (mfc CLI in automation/) ────────────────────────────

sync: ## sync the python venv (reinstalls all packages — safe across layout moves)
	@$(UV) sync --reinstall
	@# macOS sets the 'hidden' flag on files inside ~/Documents (iCloud sync
	@# behaviour). Python's site.py skips hidden .pth files (breaks editable
	@# install) and iCloud can also evict whole files mid-run (breaks imports).
	@# chflags -R nohidden is the workaround. Long-term fix: move .venv out
	@# of ~/Documents (set UV_PROJECT_ENVIRONMENT).
	@chflags -R nohidden automation/.venv 2>/dev/null || true

status: ## list public tables and row counts
	@$(UV) run mfc status

apply-schema: ## run automation/db/schema.sql
	@$(UV) run mfc apply-schema

seed-metrics: ## run automation/db/seed_metrics.sql (54-marker catalog)
	@$(UV) run mfc seed-metrics

sync-recipes: ## sync recipe metadata DB↔local; chains sync-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-recipes --direction $(DIRECTION) && \
	  $(UV) run mfc sync-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB+Storage → local. Recipe rows become recipe.json files; bytes pulled into web/assets/recipes/.\n"; \
	  printf "  push — local → DB+Storage. Bundle JSONs upserted into DB; local images pushed to Storage.\n"; \
	  printf "  both — pull then push. Last-modified wins per recipe and per image.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-recipes --direction $$d && $(UV) run mfc sync-images --direction $$d; \
	fi

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

sync-utensils: ## sync utensil library DB↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-utensils --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — DB → local. Rebuilds utensil.json bundles from rows.\n"; \
	  printf "  push — local → DB. Upserts bundles into utensils + utensil_buy_links.\n"; \
	  printf "  both — pull then push. Last-modified wins per utensil.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-utensils --direction $$d; \
	fi

create-utensil: ## create utensil from amazon url; required URL=<amazon-url> [ID=<slug>] [FORCE=1] [NO_DB=1] [NO_IMAGE=1]
	@$(UV) run mfc create-utensil "$(URL)" $(if $(ID),--id "$(ID)") $(if $(FORCE),--force) $(if $(NO_DB),--no-db) $(if $(NO_IMAGE),--no-image)

list-users: ## list users; optional ROLE=user|chef|admin Q=alice
	@$(UV) run mfc list-users $(if $(ROLE),--role $(ROLE)) $(if $(Q),--q $(Q))

set-role: ## change role; required USER=<email-or-uuid> ROLE=<user|chef|admin>
	@$(UV) run mfc set-role --user "$(USER)" --role "$(ROLE)"

suspend-user: ## suspend (ban) a user; required USER=<email-or-uuid>
	@$(UV) run mfc suspend-user --user "$(USER)"

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

# ───── Routine Dagster pipelines ──────────────────────────────────────────

.PHONY: routine routine-sync routine-test

routine: ## launch the routine dagster UI on :3000
	@uv --project routine run dagster dev

routine-sync: ## sync the routine python venv (after editing routine/pyproject.toml)
	@uv --project routine sync

routine-test: ## run the routine pytest suite
	@uv --project routine run pytest
