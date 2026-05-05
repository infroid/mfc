"""MyFoodCraving Supabase management CLI.

Run via Make (`make status` from the repo root) or directly:
    uv --project automation run mfc <cmd>

Layering:
  commands -> ops -> clients/files -> core
Lower layers never import from higher.
"""

__version__ = "0.1.0"
