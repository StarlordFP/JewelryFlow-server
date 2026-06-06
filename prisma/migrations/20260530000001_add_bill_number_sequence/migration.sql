-- Migration: add_bill_number_sequence
--
-- Creates a dedicated PostgreSQL sequence for bill numbers.
-- This replaces the broken count()-based approach in BillNumberService which:
--   1. Was NOT atomic — two concurrent requests could read the same count and
--      both generate the same bill number, causing a unique constraint violation.
--   2. Broke permanently if any transaction row was ever deleted (count shrinks,
--      numbers collide with existing bills).
--
-- A sequence is atomic by design: nextval() is guaranteed unique and never
-- repeats, even under maximum concurrent load. It never resets on row deletion.
--
-- The sequence starts at 1 (BILL-000001).
-- IF the database already has transactions, start above the current max to
-- avoid collisions:
--   SELECT setval('bill_number_seq', MAX(CAST(SUBSTRING(bill_number FROM 6) AS INT)))
--   FROM transactions WHERE bill_number LIKE 'BILL-%';

CREATE SEQUENCE IF NOT EXISTS bill_number_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;
