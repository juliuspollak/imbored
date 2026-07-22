-- Phase: release notes sync support
-- Run this in Supabase SQL Editor.

alter table release_notes add column external_id text unique;
