-- Adds unsubscribe tracking to the waitlist table.
-- Run this once in the Supabase SQL Editor.

alter table waitlist
  add column if not exists unsubscribed boolean not null default false,
  add column if not exists welcome_email_sent_at timestamptz;
