-- Phase 1: one row per issued ticket.
-- Safe to re-run: table and indexes are created only when missing.

CREATE TABLE IF NOT EXISTS public.tickets (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  transaction_id text NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tier text NOT NULL,
  participant_name text NOT NULL,
  participant_index integer NOT NULL,
  status text NOT NULL DEFAULT 'valid',
  issued_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  used_by text,
  CONSTRAINT tickets_code_unique UNIQUE (code),
  CONSTRAINT tickets_order_index_unique UNIQUE (transaction_id, participant_index),
  CONSTRAINT tickets_tier_check CHECK (tier IN ('premium', 'vip', 'classic')),
  CONSTRAINT tickets_status_check CHECK (status IN ('valid', 'used', 'revoked'))
);

CREATE INDEX IF NOT EXISTS tickets_transaction_id_idx
  ON public.tickets (transaction_id);

CREATE INDEX IF NOT EXISTS tickets_status_tier_idx
  ON public.tickets (status, tier);

CREATE INDEX IF NOT EXISTS tickets_used_at_idx
  ON public.tickets (used_at)
  WHERE used_at IS NOT NULL;
