-- Seed: comprehensive health-marker catalog (54 markers). Idempotent via ON CONFLICT.
-- Reference ranges are conservative adult values; adjust per locale/lab as needed.
-- Sex-specific bounds (normal_min/max_female/male) override the unisex baseline
-- on 5 markers where clinically meaningful: hemoglobin, ferritin, iron,
-- transferrin_saturation, uric_acid. Everything else uses unisex columns.
-- Categories: lipid | metabolic | iron-panel | inflammation | liver | kidney
--             | vitamin | mineral | thyroid | other
-- sort_order convention: 10s gap per category for admin-wedged custom rows.

INSERT INTO public.metric_definitions (
  id, name, unit, normal_min, normal_max,
  normal_min_female, normal_max_female,
  normal_min_male,   normal_max_male,
  category, sort_order, description
) VALUES
  -- Iron panel (sex-specific where iron stores differ by menstruation)
  ('iron',                    'Iron (Serum)',          'µg/dL',  60,   170,   50,   170,   65,   175,   'iron-panel', 100, 'Circulating iron available for hemoglobin synthesis. Boosted by red meat, lentils, spinach + vitamin C.'),
  ('ferritin',                'Ferritin',              'ng/mL',  30,   400,   13,   150,   30,   400,   'iron-panel', 110, 'Storage iron — depletes before anemia shows. Same diet drivers as iron.'),
  ('tibc',                    'TIBC',                  'µg/dL',  240,  450,   NULL, NULL,  NULL, NULL,  'iron-panel', 120, 'Total iron-binding capacity. Rises when iron stores are low — inverse signal of ferritin.'),
  ('transferrin_saturation',  'Transferrin Saturation','%',      20,   50,    15,   50,    20,   50,    'iron-panel', 130, 'Percent of transferrin carrying iron. <20% suggests deficiency; >50% suggests overload.'),
  ('hemoglobin',              'Hemoglobin',            'g/dL',   12,   17,    12.0, 15.5,  13.5, 17.5,  'iron-panel', 140, 'Oxygen-carrying protein in red blood cells. Drops with iron, B12, or folate deficiency.'),

  -- Inflammation (uric acid is sex-specific)
  ('hs_crp',                  'hs-CRP',                'mg/L',   NULL, 1.0,   NULL, NULL,  NULL, NULL,  'inflammation', 150, 'High-sensitivity inflammation marker. Lowered by omega-3, fiber, plant-rich diets.'),
  ('homocysteine',            'Homocysteine',          'µmol/L', 5,    15,    NULL, NULL,  NULL, NULL,  'inflammation', 160, 'Amino acid byproduct — elevated levels signal B12, folate, or B6 deficiency.'),
  ('uric_acid',               'Uric Acid',             'mg/dL',  2.4,  7.0,   2.4,  6.0,   3.4,  7.0,   'inflammation', 170, 'Purine metabolism end-product. Lowered by reducing red meat, alcohol, fructose.'),

  -- Lipid panel (unisex; cutoffs are shared)
  ('cholesterol',             'Total Cholesterol',     'mg/dL',  NULL, 200,   NULL, NULL,  NULL, NULL,  'lipid', 200, 'Sum of LDL, HDL, and a fraction of triglycerides. Diet-modifiable via saturated fat and fiber.'),
  ('ldl',                     'LDL Cholesterol',       'mg/dL',  NULL, 100,   NULL, NULL,  NULL, NULL,  'lipid', 210, '"Bad" cholesterol — drives plaque buildup. Lowered by soluble fiber (oats, beans), unsaturated fats.'),
  ('hdl',                     'HDL Cholesterol',       'mg/dL',  40,   NULL,  NULL, NULL,  NULL, NULL,  'lipid', 220, '"Good" cholesterol — clears arterial plaque. Raised by exercise, omega-3, monounsaturated fats.'),
  ('non_hdl',                 'Non-HDL Cholesterol',   'mg/dL',  NULL, 130,   NULL, NULL,  NULL, NULL,  'lipid', 230, 'Total minus HDL — captures all atherogenic particles. Stronger predictor than LDL alone.'),
  ('triglycerides',           'Triglycerides',         'mg/dL',  NULL, 150,   NULL, NULL,  NULL, NULL,  'lipid', 240, 'Stored fat in blood. Lowered by reducing refined carbs, sugar, alcohol.'),
  ('vldl',                    'VLDL Cholesterol',      'mg/dL',  5,    40,    NULL, NULL,  NULL, NULL,  'lipid', 250, 'Very-low-density lipoprotein — carries triglycerides; falls when triglycerides fall.'),
  ('apo_b',                   'ApoB',                  'mg/dL',  NULL, 100,   NULL, NULL,  NULL, NULL,  'lipid', 260, 'Apolipoprotein B — count of atherogenic particles. Better cardiovascular predictor than LDL.'),
  ('lp_a',                    'Lp(a)',                 'mg/dL',  NULL, 30,    NULL, NULL,  NULL, NULL,  'lipid', 270, 'Lipoprotein(a) — largely genetic. Diet has minimal effect; useful for risk stratification.'),

  -- Metabolic / glycemic
  ('hba1c',                   'HbA1c',                 '%',      NULL, 5.7,   NULL, NULL,  NULL, NULL,  'metabolic', 300, 'Three-month glucose average — gold standard for diabetes risk. Lowered by reducing refined carbs.'),
  ('glucose',                 'Fasting Glucose',       'mg/dL',  70,   99,    NULL, NULL,  NULL, NULL,  'metabolic', 310, 'Fasting blood sugar. Spikes after refined carbs; stabilized by fiber, protein, healthy fats.'),
  ('fasting_insulin',         'Fasting Insulin',       'µIU/mL', 2,    20,    NULL, NULL,  NULL, NULL,  'metabolic', 320, 'Pancreas output to manage glucose. Elevated levels precede insulin resistance.'),
  ('c_peptide',               'C-Peptide',             'ng/mL',  0.8,  3.1,   NULL, NULL,  NULL, NULL,  'metabolic', 330, 'Secreted alongside insulin — better marker of native pancreatic insulin production.'),

  -- Liver enzymes
  ('alt',                     'ALT',                   'U/L',    7,    55,    NULL, NULL,  NULL, NULL,  'liver', 400, 'Liver enzyme — leaks into blood with liver stress. Raised by alcohol, fatty liver, ultra-processed diets.'),
  ('ast',                     'AST',                   'U/L',    8,    48,    NULL, NULL,  NULL, NULL,  'liver', 410, 'Liver and muscle enzyme. Raised by alcohol, intense exercise, liver inflammation.'),
  ('ggt',                     'GGT',                   'U/L',    9,    48,    NULL, NULL,  NULL, NULL,  'liver', 420, 'Gamma-GT — sensitive marker for alcohol exposure and biliary stress.'),
  ('alp',                     'ALP',                   'U/L',    40,   129,   NULL, NULL,  NULL, NULL,  'liver', 430, 'Alkaline phosphatase — bone and liver enzyme. High levels can signal bile duct or bone issues.'),

  -- Kidney (creatinine sex-specific by muscle mass)
  ('albumin',                 'Albumin',               'g/dL',   3.5,  5.0,   NULL, NULL,  NULL, NULL,  'kidney', 500, 'Main blood protein, made in liver. Low levels signal poor protein intake or liver/kidney issues.'),
  ('total_protein',           'Total Protein',         'g/dL',   6.0,  8.3,   NULL, NULL,  NULL, NULL,  'kidney', 510, 'Albumin + globulins. Reflects nutrition status and liver function.'),
  ('bun',                     'BUN',                   'mg/dL',  7,    20,    NULL, NULL,  NULL, NULL,  'kidney', 520, 'Blood urea nitrogen — kidney filtration byproduct. Raised by high protein and dehydration.'),
  ('creatinine',              'Creatinine',            'mg/dL',  0.6,  1.3,   0.6,  1.1,   0.7,  1.3,   'kidney', 530, 'Muscle metabolism byproduct — primary kidney filtration marker. Varies by muscle mass.'),

  -- Vitamins, fat-soluble
  ('vitamin_a',               'Vitamin A (Retinol)',   'µg/dL',  30,   80,    NULL, NULL,  NULL, NULL,  'vitamin', 600, 'Vision, immune, skin. Sources: liver, eggs, dairy; beta-carotene from carrots and sweet potato.'),
  ('d3',                      'Vitamin D (25-OH)',     'ng/mL',  30,   60,    NULL, NULL,  NULL, NULL,  'vitamin', 610, 'Bone, immune, mood. Made by sun; food sources: fatty fish, egg yolk, fortified dairy.'),
  ('vitamin_e',               'Vitamin E (α-tocopherol)','mg/L', 5.5,  17,    NULL, NULL,  NULL, NULL,  'vitamin', 620, 'Antioxidant. Sources: nuts, seeds, vegetable oils, leafy greens.'),
  ('vitamin_k',               'Vitamin K (Phylloquinone)','ng/mL',0.13, 1.19, NULL, NULL,  NULL, NULL,  'vitamin', 630, 'Clotting and bone. Sources: leafy greens, broccoli, fermented foods (K2).'),

  -- Vitamins, water-soluble
  ('b1',                      'Vitamin B1 (Thiamine)', 'nmol/L', 78,   185,   NULL, NULL,  NULL, NULL,  'vitamin', 640, 'Energy metabolism. Sources: whole grains, pork, legumes. Low in alcohol-heavy diets.'),
  ('b2',                      'Vitamin B2 (Riboflavin)','nmol/L',137,  370,   NULL, NULL,  NULL, NULL,  'vitamin', 650, 'Energy metabolism, antioxidant cycling. Sources: dairy, eggs, leafy greens, almonds.'),
  ('b3',                      'Vitamin B3 (Niacin)',   'nmol/L', 14,   82,    NULL, NULL,  NULL, NULL,  'vitamin', 660, 'Energy, DNA repair, lipid metabolism. Sources: meat, fish, peanuts, whole grains.'),
  ('b5',                      'Vitamin B5 (Pantothenic)','ng/mL',37,   147,   NULL, NULL,  NULL, NULL,  'vitamin', 670, 'Coenzyme A synthesis. Widely available in foods; deficiency clinically rare.'),
  ('b6',                      'Vitamin B6',            'ng/mL',  5,    50,    NULL, NULL,  NULL, NULL,  'vitamin', 680, 'Neurotransmitter and homocysteine metabolism. Sources: poultry, fish, potatoes, bananas.'),
  ('b7',                      'Vitamin B7 (Biotin)',   'ng/L',   200,  500,   NULL, NULL,  NULL, NULL,  'vitamin', 690, 'Fatty acid synthesis, hair/skin/nails. Sources: eggs, nuts, seeds, salmon.'),
  ('folate',                  'Folate (B9)',           'ng/mL',  3,    17,    NULL, NULL,  NULL, NULL,  'vitamin', 700, 'DNA synthesis, neural development. Sources: leafy greens, legumes, citrus, fortified grains.'),
  ('b12',                     'Vitamin B12',           'pg/mL',  200,  900,   NULL, NULL,  NULL, NULL,  'vitamin', 710, 'Cobalamin — nerve health, red blood cells. Animal-sourced; vegans need supplementation.'),
  ('vitamin_c',               'Vitamin C',             'mg/dL',  0.4,  2.0,   NULL, NULL,  NULL, NULL,  'vitamin', 720, 'Antioxidant, collagen, iron absorption. Sources: citrus, peppers, berries, kiwi.'),

  -- Minerals, major
  ('calcium',                 'Calcium',               'mg/dL',  8.5,  10.5,  NULL, NULL,  NULL, NULL,  'mineral', 800, 'Bone, muscle, nerve function. Sources: dairy, leafy greens, fortified plant milks.'),
  ('magnesium',               'Magnesium',             'mg/dL',  1.7,  2.2,   NULL, NULL,  NULL, NULL,  'mineral', 810, '300+ enzyme reactions, muscle, sleep. Sources: nuts, seeds, dark chocolate, leafy greens.'),
  ('phosphorus',              'Phosphorus',            'mg/dL',  2.5,  4.5,   NULL, NULL,  NULL, NULL,  'mineral', 820, 'Bone mineral and ATP energy storage. Sources: dairy, meat, legumes, whole grains.'),
  ('potassium',               'Potassium',             'mEq/L',  3.5,  5.0,   NULL, NULL,  NULL, NULL,  'mineral', 830, 'Cellular hydration, muscle, blood pressure. Sources: potatoes, bananas, beans, leafy greens.'),
  ('sodium',                  'Sodium',                'mEq/L',  135,  145,   NULL, NULL,  NULL, NULL,  'mineral', 840, 'Fluid balance, nerve signaling. Reduce processed-food intake if blood pressure is elevated.'),

  -- Minerals, trace
  ('zinc',                    'Zinc',                  'µg/dL',  70,   120,   NULL, NULL,  NULL, NULL,  'mineral', 850, 'Immune, wound healing, taste. Sources: oysters, beef, pumpkin seeds, lentils.'),
  ('copper',                  'Copper',                'µg/dL',  70,   140,   NULL, NULL,  NULL, NULL,  'mineral', 860, 'Iron metabolism, connective tissue. Sources: shellfish, organ meats, nuts, dark chocolate.'),
  ('selenium',                'Selenium',              'ng/mL',  70,   150,   NULL, NULL,  NULL, NULL,  'mineral', 870, 'Antioxidant cofactor, thyroid hormone activation. Sources: brazil nuts, tuna, eggs.'),
  ('iodine',                  'Iodine (Urinary)',      'µg/L',   100,  200,   NULL, NULL,  NULL, NULL,  'mineral', 880, 'Thyroid hormone synthesis. Sources: iodized salt, seaweed, dairy, eggs. Spot urine measurement.'),
  ('manganese',               'Manganese',             'µg/L',   4,    15,    NULL, NULL,  NULL, NULL,  'mineral', 890, 'Bone formation, antioxidant cofactor. Sources: whole grains, legumes, leafy greens, nuts.'),
  ('chromium',                'Chromium',              'µg/L',   0.05, 0.5,   NULL, NULL,  NULL, NULL,  'mineral', 900, 'Insulin sensitivity. Sources: broccoli, whole grains, brewer''s yeast.'),

  -- Thyroid
  ('tsh',                     'TSH',                   'mIU/L',  0.4,  4.0,   NULL, NULL,  NULL, NULL,  'thyroid', 1000, 'Thyroid stimulating hormone. Iodine, selenium, and tyrosine support thyroid function.'),

  -- Other diet-related
  ('omega3_index',            'Omega-3 Index',         '%',      8,    NULL,  NULL, NULL,  NULL, NULL,  'other', 1100, 'Red blood cell EPA + DHA percentage. Target ≥8% for cardiovascular protection. Raised by fatty fish.')
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
  sort_order        = EXCLUDED.sort_order,
  description       = EXCLUDED.description;
