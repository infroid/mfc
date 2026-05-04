-- Seed: baseline health-marker catalog. Idempotent via ON CONFLICT.
-- Normal ranges are conservative adult reference values; adjust per locale/lab as needed.
-- Where biological-sex-specific ranges are clinically established (iron panel,
-- creatinine, etc.), the *_female / *_male columns override the unisex baseline.
-- Admin can add more markers via Supabase Studio.

INSERT INTO public.metric_definitions (
  id, name, unit, normal_min, normal_max,
  normal_min_female, normal_max_female,
  normal_min_male,   normal_max_male,
  category, sort_order
) VALUES
  -- Mineral / iron panel — sex-specific (iron stores differ by menstruation)
  ('iron',         'Iron (Serum)',      'µg/dL', 60,  170,   50, 170,   65, 175,  'mineral', 10),
  ('ferritin',     'Ferritin',          'ng/mL', 30,  400,   13, 150,   30, 400,  'mineral', 11),
  ('hemoglobin',   'Hemoglobin',        'g/dL',  12,  17,    12.0, 15.5, 13.5, 17.5, 'blood', 12),
  ('magnesium',    'Magnesium',         'mg/dL', 1.7, 2.2,   NULL, NULL, NULL, NULL, 'mineral', 20),
  ('calcium',      'Calcium',           'mg/dL', 8.5, 10.5,  NULL, NULL, NULL, NULL, 'mineral', 21),
  ('zinc',         'Zinc',              'µg/dL', 70,  120,   NULL, NULL, NULL, NULL, 'mineral', 22),
  ('potassium',    'Potassium',         'mEq/L', 3.5, 5.0,   NULL, NULL, NULL, NULL, 'mineral', 23),
  ('sodium',       'Sodium',            'mEq/L', 135, 145,   NULL, NULL, NULL, NULL, 'mineral', 24),

  -- Vitamins (no clinically-meaningful sex split)
  ('b12',          'Vitamin B12',       'pg/mL', 200, 900,   NULL, NULL, NULL, NULL, 'vitamin', 30),
  ('folate',       'Folate (B9)',       'ng/mL', 3,   17,    NULL, NULL, NULL, NULL, 'vitamin', 31),
  ('d3',           'Vitamin D (25-OH)', 'ng/mL', 30,  60,    NULL, NULL, NULL, NULL, 'vitamin', 32),
  ('b6',           'Vitamin B6',        'ng/mL', 5,   50,    NULL, NULL, NULL, NULL, 'vitamin', 33),
  ('vitamin_c',    'Vitamin C',         'mg/dL', 0.4, 2.0,   NULL, NULL, NULL, NULL, 'vitamin', 34),

  -- Lipid panel (targets are unisex; women trend higher HDL but the cutoff is shared)
  ('cholesterol',  'Total Cholesterol', 'mg/dL', NULL, 200,  NULL, NULL, NULL, NULL, 'lipid',  40),
  ('ldl',          'LDL Cholesterol',   'mg/dL', NULL, 100,  NULL, NULL, NULL, NULL, 'lipid',  41),
  ('hdl',          'HDL Cholesterol',   'mg/dL', 40,   NULL, NULL, NULL, NULL, NULL, 'lipid',  42),
  ('triglycerides','Triglycerides',     'mg/dL', NULL, 150,  NULL, NULL, NULL, NULL, 'lipid',  43),

  -- Metabolic (unisex)
  ('hba1c',        'HbA1c',             '%',     NULL, 5.7,  NULL, NULL, NULL, NULL, 'metabolic', 50),
  ('glucose',      'Fasting Glucose',   'mg/dL', 70,   99,   NULL, NULL, NULL, NULL, 'metabolic', 51),

  -- Thyroid (unisex)
  ('tsh',          'TSH',               'mIU/L', 0.4,  4.0,  NULL, NULL, NULL, NULL, 'thyroid', 60),

  -- Kidney — creatinine differs by muscle mass / sex
  ('creatinine',   'Creatinine',        'mg/dL', 0.6,  1.3,  0.6, 1.1,  0.7, 1.3,  'kidney',  70)
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  unit              = EXCLUDED.unit,
  normal_min        = EXCLUDED.normal_min,
  normal_max        = EXCLUDED.normal_max,
  normal_min_female = EXCLUDED.normal_min_female,
  normal_max_female = EXCLUDED.normal_max_female,
  normal_min_male   = EXCLUDED.normal_min_male,
  normal_max_male   = EXCLUDED.normal_max_male,
  category          = EXCLUDED.category,
  sort_order        = EXCLUDED.sort_order;
