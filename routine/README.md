# routine — local Dagster pipelines

Sibling to `automation/`. Hosts five Dagster jobs run from a local
`dagster dev` UI. Outputs land under `routine/artifacts/<run_id>/`
(gitignored).

## Setup (once)

```bash
brew install uv tesseract poppler

# from the repo root, copy the env template if you haven't already
cp .env.sample .env
$EDITOR .env

make routine-sync
```

## Run

```bash
make routine        # launches dagster dev on http://localhost:3000
make routine-test   # pytest
```

## Layout

```
routine/
  pyproject.toml
  workspace.yaml
  routine/
    definitions.py        # Dagster code location
    resources/            # SupabaseResource, env loader
    jobs/                 # one file per job
    lib/                  # tiny shared helpers (paths, run config)
    templates/            # Jinja2 templates
  artifacts/              # gitignored output root
  tests/
```

## How to add a job

1. Copy an existing file under `routine/routine/jobs/<name>.py`.
2. Define your op(s) and wire a `@job`.
3. Append the new job to the `jobs=[…]` list in `routine/routine/definitions.py`.
4. (Optional) Add a Make target if it should have a one-shot launcher.
