# mfc — MyFoodCraving Supabase management CLI

Self-contained Python tool. uv handles the venv and Python version.

## Setup (once)

```bash
# install uv if you don't have it
brew install uv                  # or: curl -LsSf https://astral.sh/uv/install.sh | sh

# from the repo root, copy the env template and fill in your Supabase keys
cp automation/.env.sample automation/.env
$EDITOR automation/.env

# sync the venv
make sync
```

## Run commands

All targets sit at the repo root in the `Makefile`:

```bash
make                     # list all targets
make status              # public table list + row counts
make apply-schema        # run automation/db/schema.sql
make seed-metrics        # run automation/db/seed_metrics.sql
make sync-recipes        # interactive bidirectional recipe sync (DB↔local + bytes)
make sync-images         # interactive bidirectional image sync (bucket↔local)
make drop-schema         # destructive — type "wipe" to confirm
make reset               # destructive — drop + apply + seed + push recipes
```

Or call `mfc` directly without going through Make:

```bash
uv --project automation run mfc --help
uv --project automation run mfc status
```

## Layout

```
automation/
  pyproject.toml      uv-managed dependencies + entry point
  .python-version     interpreter pin (uv installs it on demand)
  .env.sample         committed template
  .env                local credentials (gitignored)
  mfc/                the Python package
    cli.py            argparse + command registry
    core/             config, log, prompts, files (filesystem helpers)
    clients/          pg (psycopg) + sb (supabase-py) factories
    ops/              schema, seed, recipes (bidirectional sync), images, users
    commands/         thin CLI wrappers, one per `mfc <cmd>`
```

Layering: `commands → ops → clients/files → core`. Lower layers never
import from higher.

## Adding a command

1. Add a function to (or create) `mfc/ops/<domain>.py` with the actual work.
2. Create `mfc/commands/<name>.py` with `register(subparsers)` and `run(args, config)`.
3. Append the new command module to `COMMAND_MODULES` in `mfc/cli.py`.
4. Add a `make <name>` target in the root `Makefile`.
