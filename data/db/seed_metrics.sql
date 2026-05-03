-- Seed: baseline health-marker catalog. Idempotent via ON CONFLICT.
-- Normal ranges are conservative adult reference values; adjust per locale/lab as needed.
-- Admin can add more markers via Supabase Studio.

INSERT INTO public.metric_definitions (id, name, unit, normal_min, normal_max, category, sort_order) VALUES
  -- Mineral / iron panel
  ('iron',         'Iron (Serum)',      'µg/dL', 60,  170, 'mineral', 10),
  ('ferritin',     'Ferritin',          'ng/mL', 30,  400, 'mineral', 11),
  ('hemoglobin',   'Hemoglobin',        'g/dL',  12,  17,  'blood',   12),
  ('magnesium',    'Magnesium',         'mg/dL', 1.7, 2.2, 'mineral', 20),
  ('calcium',      'Calcium',           'mg/dL', 8.5, 10.5,'mineral', 21),
  ('zinc',         'Zinc',              'µg/dL', 70,  120, 'mineral', 22),
  ('potassium',    'Potassium',         'mEq/L', 3.5, 5.0, 'mineral', 23),
  ('sodium',       'Sodium',            'mEq/L', 135, 145, 'mineral', 24),

  -- Vitamins
  ('b12',          'Vitamin B12',       'pg/mL', 200, 900, 'vitamin', 30),
  ('folate',       'Folate (B9)',       'ng/mL', 3,   17,  'vitamin', 31),
  ('d3',           'Vitamin D (25-OH)', 'ng/mL', 30,  60,  'vitamin', 32),
  ('b6',           'Vitamin B6',        'ng/mL', 5,   50,  'vitamin', 33),
  ('vitamin_c',    'Vitamin C',         'mg/dL', 0.4, 2.0, 'vitamin', 34),

  -- Lipid panel
  ('cholesterol',  'Total Cholesterol', 'mg/dL', NULL, 200, 'lipid',  40),
  ('ldl',          'LDL Cholesterol',   'mg/dL', NULL, 100, 'lipid',  41),
  ('hdl',          'HDL Cholesterol',   'mg/dL', 40,   NULL,'lipid',  42),
  ('triglycerides','Triglycerides',     'mg/dL', NULL, 150, 'lipid',  43),

  -- Metabolic
  ('hba1c',        'HbA1c',             '%',     NULL, 5.7, 'metabolic', 50),
  ('glucose',      'Fasting Glucose',   'mg/dL', 70,   99,  'metabolic', 51),

  -- Thyroid / liver / kidney
  ('tsh',          'TSH',               'mIU/L', 0.4,  4.0, 'thyroid', 60),
  ('creatinine',   'Creatinine',        'mg/dL', 0.6,  1.3, 'kidney',  70)
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  unit        = EXCLUDED.unit,
  normal_min  = EXCLUDED.normal_min,
  normal_max  = EXCLUDED.normal_max,
  category    = EXCLUDED.category,
  sort_order  = EXCLUDED.sort_order;
