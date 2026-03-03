-- Baseline training groups
INSERT INTO training_groups (code, display_name, is_active)
VALUES
  ('U9', 'Under 9', TRUE),
  ('U11', 'Under 11', TRUE),
  ('U13', 'Under 13', TRUE),
  ('U15', 'Under 15', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Optional starter coach (insert once)
INSERT INTO coaches (full_name, phone, email, is_active)
SELECT 'Head Coach', '+264810000001', 'coach@dynaverse.example', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM coaches WHERE email = 'coach@dynaverse.example'
);

-- Core operations/funding baseline
INSERT INTO funding_sources (source_code, name, source_type, committed_amount, received_amount, currency)
VALUES
  ('FUND-CORE', 'Core Academy Fund', 'internal', 0, 0, 'NAD')
ON CONFLICT (source_code) DO NOTHING;

INSERT INTO inventory_items (
  item_code,
  name,
  category,
  unit,
  stock_on_hand,
  minimum_stock_level,
  target_stock_level,
  reorder_quantity
)
VALUES
  ('ITEM-BIBS', 'Training Bibs', 'equipment', 'pcs', 12, 30, 40, 20),
  ('ITEM-BALL', 'Match Balls', 'equipment', 'pcs', 8, 15, 20, 10)
ON CONFLICT (item_code) DO NOTHING;
