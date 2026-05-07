"""Supabase resource: publishable client, secret client, raw psycopg connection."""

from __future__ import annotations

import psycopg
from dagster import ConfigurableResource
from supabase import Client, create_client


class SupabaseResource(ConfigurableResource):
    """Reads SUPABASE_* env vars at construction time."""

    url: str
    publishable_key: str
    secret_key: str
    db_url: str

    def client(self) -> Client:
        """RLS-respecting client (publishable key)."""
        return create_client(self.url, self.publishable_key)

    def admin_client(self) -> Client:
        """RLS-bypass client (secret key)."""
        return create_client(self.url, self.secret_key)

    def pg(self) -> psycopg.Connection:
        """Raw psycopg connection — caller is responsible for closing."""
        return psycopg.connect(self.db_url)
