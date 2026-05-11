# MyFoodCraving — root Makefile
#
# Single entry point for every chore. The Python tool lives in `automation/`
# and is run via uv (auto-creates a venv from automation/pyproject.toml).
#
# Bootstrap (once):
#   brew install uv         # or: curl -LsSf https://astral.sh/uv/install.sh | sh
#   cp .env.sample .env  # then fill in keys
#   make sync
#
# Run `make` (or `make help`) to see all targets, grouped by purpose.
# For per-flag help on any underlying CLI subcommand:
#   uv --project automation run mfc <subcommand> --help

UV := uv --project automation

.DEFAULT_GOAL := help

.PHONY: help \
        sync apply-schema seed-metrics \
        status list-users set-role suspend-user \
        sync-recipes sync-images \
        sync-utensils sync-utensil-images \
        sync-ingredients sync-ingredient-images \
        update-utensil \
        init-catalog import-usda import-ingredient import-recipe import-utensil gen-nutrition-doc \
        fetch-ingredient-images fetch-ingredient-nutrition \
        drop-schema reset \
        serve \
        routine routine-sync routine-test

help: ## list all targets, grouped by purpose
	@printf "\033[1mMyFoodCraving — make targets\033[0m\n"
	@awk 'BEGIN { FS = ":.*?## " } \
	     /^##@ / { printf "\n\033[1;33m%s\033[0m\n", substr($$0, 5); next } \
	     /^[a-zA-Z][a-zA-Z0-9_-]+:.*?## / { printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2 }' \
	     $(MAKEFILE_LIST)
	@printf "\n\033[1;33mFlag-level help\033[0m\n"
	@printf "  Most targets above wrap an mfc subcommand; the description shows\n"
	@printf "  the env-var knobs (e.g. FORCE=1 LIMIT=10 IDS=a,b). For the full\n"
	@printf "  flag list of any subcommand:\n"
	@printf "    \033[36m%s\033[0m\n" "$(UV) run mfc --help                  # list every subcommand"
	@printf "    \033[36m%s\033[0m\n" "$(UV) run mfc <subcommand> --help     # full flags + dev-only options"
	@printf "\n"

##@ Setup

sync: ## sync the python venv (reinstalls all packages — safe across layout moves)
	@$(UV) sync --reinstall
	@# macOS sets the 'hidden' flag on files inside ~/Documents (iCloud sync
	@# behaviour). Python's site.py skips hidden .pth files (breaks editable
	@# install) and iCloud can also evict whole files mid-run (breaks imports).
	@# chflags -R nohidden is the workaround. Long-term fix: move .venv out
	@# of ~/Documents (set UV_PROJECT_ENVIRONMENT).
	@chflags -R nohidden automation/.venv 2>/dev/null || true

apply-schema: ## run automation/db/schema.sql
	@$(UV) run mfc apply-schema

seed-metrics: ## run automation/db/seed_metrics.sql (54-marker catalog)
	@$(UV) run mfc seed-metrics

##@ Status & users

status: ## list public tables and row counts
	@$(UV) run mfc status

list-users: ## list users; optional ROLE=user|chef|admin Q=alice
	@$(UV) run mfc list-users $(if $(ROLE),--role $(ROLE)) $(if $(Q),--q $(Q))

set-role: ## change role; required USER=<email-or-uuid> ROLE=<user|chef|admin>
	@$(UV) run mfc set-role --user "$(USER)" --role "$(ROLE)"

suspend-user: ## suspend (ban) a user; required USER=<email-or-uuid>
	@$(UV) run mfc suspend-user --user "$(USER)"

##@ Sync — DB ↔ local bundles + Storage  (DIRECTION=pull|push|both, or interactive)

sync-recipes: ## sync recipe catalog automation/db.sqlite ↔ Supabase; chains sync-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-recipes --direction $(DIRECTION) && \
	  $(UV) run mfc sync-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Supabase → automation/db.sqlite. Overwrites SQLite from Supabase; bytes pulled into web/assets/recipes/.\n"; \
	  printf "  push — automation/db.sqlite → Supabase. Upserts recipes + child tables + health_facts(recipe); local images pushed to Storage.\n"; \
	  printf "  both — push then pull. SQLite is canonical for local edits.\n"; \
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

sync-utensils: ## sync utensil catalog automation/db.sqlite ↔ Supabase; chains sync-utensil-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-utensils --direction $(DIRECTION) && \
	  $(UV) run mfc sync-utensil-images --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Supabase → automation/db.sqlite. Overwrites SQLite from Supabase; bytes pulled into web/assets/utensils/.\n"; \
	  printf "  push — automation/db.sqlite → Supabase. Upserts utensils + utensil_buy_links; local images pushed to Storage.\n"; \
	  printf "  both — push then pull. SQLite is canonical for local edits.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-utensils --direction $$d && \
	    $(UV) run mfc sync-utensil-images --direction $$d; \
	fi

sync-utensil-images: ## sync utensil image bytes bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-utensil-images --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Storage → local. Downloads bucket-only files; overwrites local where Storage is newer.\n"; \
	  printf "  push — local → Storage. Uploads local-only files; overwrites remote where local is newer.\n"; \
	  printf "  both — pull then push. Last-modified wins per file.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-utensil-images --direction $$d; \
	fi

sync-ingredients: ## sync ingredient catalog automation/db.sqlite ↔ Supabase; chains sync-ingredient-images in same direction
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredients        --direction $(DIRECTION) && \
	  $(UV) run mfc sync-ingredient-images  --direction $(DIRECTION); \
	else \
	  printf "\nPick sync direction:\n"; \
	  printf "  pull — Supabase → automation/db.sqlite. Overwrites SQLite from Supabase; bytes pulled into web/assets/ingredients/.\n"; \
	  printf "  push — automation/db.sqlite → Supabase. Upserts ingredients + ingredient_details + health_facts; local images pushed to Storage.\n"; \
	  printf "  both — push then pull. SQLite is canonical for local edits; pull captures Supabase-side admin UI edits.\n"; \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredients --direction $$d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi

sync-ingredient-images: ## sync ingredient images bucket↔local; prompts (or DIRECTION=pull|push|both)
	@if [ -n "$(DIRECTION)" ]; then \
	  $(UV) run mfc sync-ingredient-images --direction $(DIRECTION); \
	else \
	  printf "\nDirection [pull/push/both]: "; \
	  read d && $(UV) run mfc sync-ingredient-images --direction $$d; \
	fi

##@ Catalog — SQLite catalog ⇄ Supabase

init-catalog: ## create automation/db.sqlite from sqlite_schema.sql; FORCE=1 to drop+recreate
	@$(UV) run mfc init-catalog $(if $(FORCE),--force)

import-ingredient: ## import one ingredient JSON; required FILE=<path>
	@$(UV) run mfc import-ingredient "$(FILE)"

import-recipe: ## import one recipe JSON; required FILE=<path>
	@$(UV) run mfc import-recipe "$(FILE)"

import-utensil: ## import one utensil JSON; required FILE=<path>
	@$(UV) run mfc import-utensil "$(FILE)"

import-usda: ## import data/usda/*.csv foundation foods into automation/db.sqlite; LIMIT=N for debug
	@$(UV) run mfc import-usda $(if $(LIMIT),--limit $(LIMIT))

gen-nutrition-doc: ## regenerate docs/NUTRITION_FIELDS.md from the USDA nutrient map
	@$(UV) run mfc gen-nutrition-doc

##@ Authoring & enrichment — local-first; sync uploads later

update-utensil: ## update utensil bundle locally from amazon url; prompts (or pass URL=<amazon-url> [ID=<slug>] [NO_IMAGE=1])
	@$(UV) run mfc update-utensil $(if $(URL),"$(URL)") $(if $(ID),--id "$(ID)") $(if $(NO_IMAGE),--no-image)

fetch-ingredient-images: ## fetch ingredient PNGs from thiings.co → web/assets/ingredients/<id>/image.png + SQLite; FORCE=1 LIMIT=N IDS=a,b
	@$(UV) run mfc fetch-ingredient-images \
	  $(if $(FORCE),--force) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))

fetch-ingredient-nutrition: ## fetch USDA FDC nutrition → automation/db.sqlite ingredient_details; FORCE=1 LIMIT=N IDS=a,b AI=1 (Anthropic fallback)
	@$(UV) run mfc fetch-ingredient-nutrition \
	  $(if $(FORCE),--force) \
	  $(if $(AI),--ai-fallback) \
	  $(if $(LIMIT),--limit $(LIMIT)) \
	  $(if $(IDS),--ids $(IDS))

##@ Destructive — confirm twice

drop-schema: ## DESTRUCTIVE — drop all public tables (prompts to confirm)
	@$(UV) run mfc drop-schema

reset: ## DESTRUCTIVE — rebuild venv + drop + apply + seed + import (one-shot reset)
	@echo "  · clearing automation/.venv and __pycache__ caches"
	@rm -rf automation/.venv
	@find automation/mfc -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
	@$(UV) sync
	@$(UV) run mfc reset

##@ Local dev server

serve: ## run the static site at http://localhost:8080 (serves web/)
	@cd web && python3 -m http.server 8080

##@ Routine (Dagster pipelines)

routine: ## launch the routine dagster UI on :3000
	@uv --project routine run dagster dev -w routine/workspace.yaml

routine-sync: ## sync the routine python venv (after editing routine/pyproject.toml)
	@uv --project routine sync

routine-test: ## run the routine pytest suite
	@cd routine && uv run pytest
