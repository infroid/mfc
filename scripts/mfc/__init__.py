"""MyFoodCraving Supabase management CLI.

Run via the wrapper script (`scripts/mfc.sh <cmd>`) or directly with
`PYTHONPATH=scripts python -m mfc <cmd>`.

Layering:
  commands -> ops -> clients/files -> core
Lower layers never import from higher.
"""

__version__ = "0.1.0"
