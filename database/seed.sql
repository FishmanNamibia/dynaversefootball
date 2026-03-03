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
