/* RECIPE DETAIL — data
   Single sample recipe (Kashmiri Rogan Josh) used by the prototype's
   recipe detail page. Nutrition follows USDA FoodData Central naming
   so the macro/micro split mirrors what the FDA panel exposes.
   Per-serving values; ~100 nutrient fields total. */

window.RECIPE_DETAIL = {
  id: "kashmiri-rogan-josh",
  name: "Kashmiri Rogan Josh",
  tagline: "Slow-braised lamb in a deeply spiced yogurt-and-Kashmiri-chili gravy — the kind of dish that makes the whole house smell like winter.",
  cuisine: "Kashmiri",
  difficulty: "Intermediate",
  rating: 4.8,
  ratingCount: 312,
  totalMinutes: 95,
  servings: 4,
  chef: "Riya Mehrotra",
  heroImage: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1200&q=80&auto=format&fit=crop",
  tags: ["non-veg", "gluten-free", "north-indian", "winter"],
  nutriTags: ["high protein", "iron rich", "moderate fat"],

  ingredients: [
    { name: "lamb shoulder, bone-in", amt: "700", unit: "g", emoji: "🍖", essential: true },
    { name: "full-fat yogurt", amt: "200", unit: "g", emoji: "🥛", essential: true },
    { name: "kashmiri red chili powder", amt: "2", unit: "tbsp", emoji: "🌶", essential: true },
    { name: "fennel powder (saunf)", amt: "1.5", unit: "tbsp", emoji: "🌿", essential: true },
    { name: "dry ginger powder (sonth)", amt: "1", unit: "tsp", emoji: "🫚", essential: true },
    { name: "asafoetida (hing)", amt: "1/4", unit: "tsp", emoji: "✨", essential: false },
    { name: "green cardamom", amt: "6", unit: "pods", emoji: "🟢", essential: true },
    { name: "black cardamom", amt: "2", unit: "pods", emoji: "⚫", essential: false },
    { name: "cinnamon stick", amt: "2", unit: "pcs", emoji: "🪵", essential: true },
    { name: "cloves", amt: "5", unit: "pcs", emoji: "🌰", essential: false },
    { name: "bay leaves", amt: "2", unit: "pcs", emoji: "🍃", essential: false },
    { name: "mustard oil", amt: "4", unit: "tbsp", emoji: "🟡", essential: true },
    { name: "saffron threads", amt: "1", unit: "pinch", emoji: "🟠", essential: false },
    { name: "salt", amt: "1.5", unit: "tsp", emoji: "🧂", essential: true },
    { name: "warm water", amt: "300", unit: "ml", emoji: "💧", essential: true },
  ],

  utensils: [
    { name: "heavy-bottom pot / dutch oven", emoji: "🫕", essential: true },
    { name: "wooden spoon", emoji: "🥄", essential: true },
    { name: "spice grinder or mortar", emoji: "⚒", essential: false },
    { name: "fine mesh strainer", emoji: "🧯", essential: false },
    { name: "small whisk", emoji: "🥢", essential: false },
    { name: "tight-fitting lid", emoji: "🟫", essential: true },
  ],

  steps: [
    {
      title: "Bloom the mustard oil",
      detail: "Heat mustard oil in a heavy-bottom pot until it just begins to smoke — about 2 minutes on medium-high. Take it off the heat for 30 seconds; this softens its raw bite. Return to a steady medium flame.",
      duration: 240,
      tip: "If you skip the smoking step, the lamb will taste sharply of raw mustard. Don't rush it.",
    },
    {
      title: "Crackle the whole spices",
      detail: "Drop in green cardamom, black cardamom, cinnamon, cloves and bay leaves. Stir for 30–40 seconds until they release a deep, warm fragrance. Add a pinch of asafoetida — it will sputter and bloom into the oil.",
      duration: 180,
      tip: "Whole spices first, ground spices later. Reverse this order and you'll burn the powder.",
    },
    {
      title: "Sear the lamb in batches",
      detail: "Pat the lamb pieces fully dry with paper towels — moisture is the enemy of a crust. Sear in 2–3 batches over high heat, 3 minutes per side, until each piece has a deep mahogany color. Remove and set aside.",
      duration: 720,
      tip: "Crowding the pot is the most common mistake here. Each piece needs space to brown, not steam.",
    },
    {
      title: "Build the yogurt-chili base",
      detail: "Lower the heat. Whisk yogurt smooth in a separate bowl with the Kashmiri chili, fennel, and dry ginger. Slowly stream the spiced yogurt into the pot, stirring constantly to prevent splitting. Cook 4 minutes until the oil rises.",
      duration: 600,
      tip: "Cold yogurt added quickly to a hot pot will curdle. Temper with a ladle of pot juices first if you're nervous.",
    },
    {
      title: "Return the lamb and braise low",
      detail: "Tip the seared lamb back in along with any resting juices. Add salt and 300 ml warm water. Cover tightly, drop the heat to low, and braise for 60 minutes — stirring once at the 30-minute mark.",
      duration: 3600,
      tip: "If the gravy looks too thin at the end, uncover and reduce on medium for 5 minutes. Don't add cornstarch — that's a different cuisine.",
    },
    {
      title: "Finish with saffron and rest",
      detail: "Bloom the saffron threads in 2 tablespoons of warm water for a minute. Stir into the rogan josh, kill the heat, cover, and let it rest 8 minutes. The color will deepen and the gravy will glaze the meat.",
      duration: 540,
      tip: "Rogan josh always tastes better the next day. Make ahead if you can.",
    },
  ],

  healthFacts: [
    "lamb shoulder is rich in heme iron and B12",
    "Kashmiri chilies are deep in color, mild in heat — antioxidants without the burn",
    "saffron has been studied for mood support, in modest doses",
    "yogurt brings probiotic cultures + a creamy way to mellow spice",
    "fennel is traditionally used to ease digestion after rich meals",
    "cinnamon may help moderate post-meal blood sugar spikes",
  ],
};

// ─── FDA-SHAPED NUTRITION (per serving) ───────────────────────────
// Group → rows: [name, value, unit, %DV (or null), flag]
// flag: "high" | "warn" | null
window.RECIPE_NUTRITION = {
  servings: 4,
  basis: "Per 1 of 4 servings (~285 g)",
  source: "Computed from USDA FoodData Central · SR Legacy + Foundation foods",
  calories: 482,
  proteinG: 38,
  carbsG: 14,
  fatG: 30,

  // ────── MACROS (29 fields) ───────────────────────────────────────
  macro: [
    {
      name: "Energy",
      rows: [
        ["Calories", 482, "kcal", 24, "high"],
        ["Calories from fat", 270, "kcal", null, null],
        ["Energy", 2017, "kJ", null, null],
      ],
    },
    {
      name: "Fats",
      rows: [
        ["Total fat", 30.0, "g", 38, "high"],
        ["Saturated fat", 11.2, "g", 56, "warn"],
        ["Trans fat", 0.4, "g", null, null],
        ["Polyunsaturated fat", 3.1, "g", null, null],
        ["Monounsaturated fat", 12.6, "g", null, null],
        ["Omega-3 (ALA)", 0.18, "g", null, null],
        ["Omega-3 (EPA)", 0.04, "g", null, null],
        ["Omega-3 (DHA)", 0.02, "g", null, null],
        ["Omega-6 (LA)", 2.7, "g", null, null],
      ],
    },
    {
      name: "Carbs",
      rows: [
        ["Total carbohydrate", 14.0, "g", 5, null],
        ["Dietary fiber", 2.4, "g", 9, null],
        ["Soluble fiber", 0.9, "g", null, null],
        ["Insoluble fiber", 1.5, "g", null, null],
        ["Total sugars", 6.8, "g", null, null],
        ["Added sugars", 0.0, "g", 0, null],
        ["Sugar alcohols", 0.0, "g", null, null],
        ["Starch", 4.4, "g", null, null],
        ["Net carbs", 11.6, "g", null, null],
      ],
    },
    {
      name: "Protein",
      rows: [
        ["Total protein", 38.0, "g", 76, "high"],
        ["Essential AA", 15.2, "g", null, null],
        ["Branched-chain AA", 6.4, "g", null, null],
        ["Lysine", 3.1, "g", null, null],
        ["Methionine", 0.9, "g", null, null],
        ["Tryptophan", 0.4, "g", null, null],
      ],
    },
    {
      name: "Other",
      rows: [
        ["Cholesterol", 124, "mg", 41, "warn"],
        ["Water", 188, "g", null, null],
        ["Ash", 4.2, "g", null, null],
      ],
    },
  ],

  // ────── MICROS (~70 fields) ──────────────────────────────────────
  micro: [
    {
      name: "Vitamins (fat-soluble)",
      rows: [
        ["Vitamin A (RAE)", 86, "µg", 10, null],
        ["Vitamin A (IU)", 290, "IU", null, null],
        ["Retinol", 22, "µg", null, null],
        ["Beta-carotene", 480, "µg", null, null],
        ["Alpha-carotene", 12, "µg", null, null],
        ["Beta-cryptoxanthin", 4, "µg", null, null],
        ["Lycopene", 0, "µg", null, null],
        ["Lutein + zeaxanthin", 96, "µg", null, null],
        ["Vitamin D (D2 + D3)", 0.3, "µg", 2, null],
        ["Vitamin D (IU)", 12, "IU", null, null],
        ["Vitamin E (alpha-toc)", 1.6, "mg", 11, null],
        ["Vitamin K (phylloquinone)", 8.4, "µg", 7, null],
      ],
    },
    {
      name: "Vitamins (water-soluble)",
      rows: [
        ["Vitamin C", 11.2, "mg", 12, null],
        ["Thiamin (B1)", 0.22, "mg", 18, null],
        ["Riboflavin (B2)", 0.41, "mg", 32, "high"],
        ["Niacin (B3)", 9.8, "mg", 61, "high"],
        ["Niacin equivalents", 14.6, "mg", null, null],
        ["Pantothenic acid (B5)", 1.4, "mg", 28, "high"],
        ["Pyridoxine (B6)", 0.46, "mg", 27, "high"],
        ["Biotin (B7)", 4.2, "µg", 14, null],
        ["Folate, total", 38, "µg", 10, null],
        ["Folate, food", 36, "µg", null, null],
        ["Folic acid", 2, "µg", null, null],
        ["Folate (DFE)", 39, "µg DFE", null, null],
        ["Vitamin B12", 2.7, "µg", 113, "high"],
        ["Choline, total", 142, "mg", 26, "high"],
        ["Betaine", 7.4, "mg", null, null],
      ],
    },
    {
      name: "Major minerals",
      rows: [
        ["Calcium", 168, "mg", 13, null],
        ["Iron", 4.8, "mg", 27, "high"],
        ["Magnesium", 52, "mg", 12, null],
        ["Phosphorus", 384, "mg", 31, "high"],
        ["Potassium", 612, "mg", 13, null],
        ["Sodium", 740, "mg", 32, "warn"],
        ["Chloride", 1080, "mg", 47, "warn"],
        ["Sulfur", 312, "mg", null, null],
      ],
    },
    {
      name: "Trace minerals",
      rows: [
        ["Zinc", 6.2, "mg", 56, "high"],
        ["Copper", 0.18, "mg", 20, "high"],
        ["Manganese", 0.38, "mg", 17, null],
        ["Selenium", 38.2, "µg", 69, "high"],
        ["Iodine", 22, "µg", 15, null],
        ["Chromium", 4.4, "µg", 13, null],
        ["Molybdenum", 18, "µg", 40, "high"],
        ["Fluoride", 86, "µg", null, null],
        ["Boron", 0.42, "mg", null, null],
        ["Nickel", 6, "µg", null, null],
      ],
    },
    {
      name: "Lipids — fatty acid detail",
      rows: [
        ["SFA 4:0 butyric", 0.18, "g", null, null],
        ["SFA 6:0 caproic", 0.12, "g", null, null],
        ["SFA 8:0 caprylic", 0.08, "g", null, null],
        ["SFA 10:0 capric", 0.18, "g", null, null],
        ["SFA 12:0 lauric", 0.22, "g", null, null],
        ["SFA 14:0 myristic", 1.4, "g", null, null],
        ["SFA 16:0 palmitic", 5.8, "g", null, null],
        ["SFA 18:0 stearic", 3.0, "g", null, null],
        ["MUFA 16:1 palmitoleic", 0.62, "g", null, null],
        ["MUFA 18:1 oleic", 11.4, "g", null, null],
        ["PUFA 18:2 linoleic", 2.7, "g", null, null],
        ["PUFA 18:3 alpha-linolenic", 0.18, "g", null, null],
        ["PUFA 20:4 arachidonic", 0.14, "g", null, null],
        ["PUFA 20:5 EPA", 0.04, "g", null, null],
        ["PUFA 22:6 DHA", 0.02, "g", null, null],
      ],
    },
    {
      name: "Amino acids",
      rows: [
        ["Tryptophan", 0.42, "g", null, null],
        ["Threonine", 1.62, "g", null, null],
        ["Isoleucine", 1.78, "g", null, null],
        ["Leucine", 3.04, "g", null, null],
        ["Lysine", 3.12, "g", null, null],
        ["Methionine", 0.92, "g", null, null],
        ["Cystine", 0.46, "g", null, null],
        ["Phenylalanine", 1.54, "g", null, null],
        ["Tyrosine", 1.28, "g", null, null],
        ["Valine", 1.96, "g", null, null],
        ["Arginine", 2.42, "g", null, null],
        ["Histidine", 1.18, "g", null, null],
        ["Alanine", 2.28, "g", null, null],
        ["Aspartic acid", 3.42, "g", null, null],
        ["Glutamic acid", 5.62, "g", null, null],
        ["Glycine", 1.84, "g", null, null],
        ["Proline", 1.74, "g", null, null],
        ["Serine", 1.46, "g", null, null],
      ],
    },
    {
      name: "Other compounds",
      rows: [
        ["Caffeine", 0, "mg", null, null],
        ["Theobromine", 0, "mg", null, null],
        ["Alcohol, ethyl", 0, "g", null, null],
        ["Capsaicin", 1.4, "mg", null, null],
        ["Curcuminoids", 0, "mg", null, null],
        ["Lactose", 4.2, "g", null, null],
        ["Galactose", 0.18, "g", null, null],
      ],
    },
  ],
};
