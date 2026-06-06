-- One sequence per origin type, resets daily via the date part in the SKU
-- The sequence itself does NOT reset — date in the SKU makes it human-readable
-- Gaps are acceptable; duplicates are not
CREATE SEQUENCE IF NOT EXISTS sku_seq_trade
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS sku_seq_karigar
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE SEQUENCE IF NOT EXISTS sku_seq_purchased
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;