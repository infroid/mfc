// Shared mock data + helpers for the MFC prototype.
// Lives on window.MFC_DATA so all page modules can read it.

window.MFC_DATA = (function () {
  const RECIPES = [
    {
      id: "lemon-ricotta",
      name: "Lemon ricotta spaghetti",
      cuisine: "Italian",
      difficulty: "Easy",
      minutes: 22,
      servings: 2,
      image: "assets/lemon-ricotta-spaghetti.jpg",
      tagline: "Bright lemon, soft ricotta, black pepper.",
      tags: ["vegetarian", "high-protein"],
      diet: "veg",
      highlight: "Ready in under 25 min",
      colorSoft: "#FCE9D6",
      featured: true,
      stepCount: 5,
      updatedAt: "2026-04-29T14:22:00Z",
    },
    {
      id: "gochujang-salmon",
      name: "Gochujang salmon rice",
      cuisine: "Korean",
      difficulty: "Easy",
      minutes: 25,
      servings: 2,
      image: "assets/gochujang-salmon-rice.jpg",
      tagline: "Sweet-spicy glaze, scallion oil, jasmine rice.",
      tags: ["non-veg", "high-protein"],
      diet: "non-veg",
      highlight: "29g protein per serving",
      colorSoft: "#FBD9C0",
      featured: true,
      stepCount: 6,
      updatedAt: "2026-04-30T09:11:00Z",
    },
    {
      id: "quinoa-bowl",
      name: "Mediterranean quinoa bowl",
      cuisine: "Mediterranean",
      difficulty: "Easy",
      minutes: 30,
      servings: 2,
      image: "assets/mediterranean-quinoa-bowl.jpg",
      tagline: "Herb-tossed quinoa, lemon, olive oil.",
      tags: ["vegetarian", "gluten-free", "high-fiber"],
      diet: "veg",
      highlight: "High-fiber, plant-forward",
      colorSoft: "#E5E9C9",
      featured: true,
      stepCount: 7,
      updatedAt: "2026-04-22T18:30:00Z",
    },
    {
      id: "citrus-avocado",
      name: "Citrus avocado salad",
      cuisine: "Californian",
      difficulty: "Easy",
      minutes: 12,
      servings: 2,
      image: "assets/citrus-avocado-salad.jpg",
      tagline: "Blood orange, mint, flaky salt.",
      tags: ["vegan", "gluten-free"],
      diet: "veg",
      highlight: "10-min prep",
      colorSoft: "#FBD9C0",
      featured: false,
      stepCount: 4,
      updatedAt: "2026-04-18T11:02:00Z",
    },
    {
      id: "miso-mushroom",
      name: "Miso mushroom soup",
      cuisine: "Japanese",
      difficulty: "Easy",
      minutes: 18,
      servings: 2,
      image: "assets/miso-mushroom-soup.jpg",
      tagline: "Earthy miso, dashi, silken tofu.",
      tags: ["vegetarian"],
      diet: "veg",
      highlight: "Comfort in a bowl",
      colorSoft: "#E5E9C9",
      featured: false,
      stepCount: 5,
      updatedAt: "2026-04-12T08:44:00Z",
    },
    {
      id: "yogurt-berry",
      name: "Greek yogurt berry cup",
      cuisine: "Breakfast",
      difficulty: "Easy",
      minutes: 5,
      servings: 1,
      image: "assets/greek-yogurt-berry-cup.jpg",
      tagline: "Honey, mixed berries, oat crunch.",
      tags: ["vegetarian", "high-protein"],
      diet: "veg",
      highlight: "5-min breakfast",
      colorSoft: "#F0DCDC",
      featured: false,
      stepCount: 3,
      updatedAt: "2026-05-01T07:15:00Z",
    },
  ];

  // Library: ingredients
  const INGREDIENTS = [
    { id: "spaghetti", name: "Spaghetti", category: "grain", default_unit: "g", usage: 1, photo: null, updated_at: "2026-04-30T10:00:00Z" },
    { id: "ricotta", name: "Whole-milk ricotta", category: "dairy", default_unit: "cup", usage: 2, photo: null, updated_at: "2026-04-28T11:30:00Z" },
    { id: "parmesan", name: "Parmesan, grated", category: "dairy", default_unit: "cup", usage: 4, photo: null, updated_at: "2026-04-25T08:00:00Z" },
    { id: "lemon", name: "Lemon", category: "produce", default_unit: "ea", usage: 5, photo: null, updated_at: "2026-04-29T14:00:00Z" },
    { id: "salmon-fillet", name: "Salmon fillet", category: "protein", default_unit: "g", usage: 1, photo: null, updated_at: "2026-04-19T15:00:00Z" },
    { id: "gochujang", name: "Gochujang paste", category: "pantry", default_unit: "tbsp", usage: 2, photo: null, updated_at: "2026-04-15T09:00:00Z" },
    { id: "jasmine-rice", name: "Jasmine rice", category: "grain", default_unit: "cup", usage: 2, photo: null, updated_at: "2026-04-10T10:00:00Z" },
    { id: "scallions", name: "Scallions", category: "produce", default_unit: "stalk", usage: 3, photo: null, updated_at: "2026-04-08T11:00:00Z" },
    { id: "quinoa", name: "Quinoa", category: "grain", default_unit: "cup", usage: 1, photo: null, updated_at: "2026-04-22T18:00:00Z" },
    { id: "olive-oil", name: "Extra-virgin olive oil", category: "pantry", default_unit: "tbsp", usage: 6, photo: null, updated_at: "2026-04-30T12:00:00Z" },
    { id: "miso-white", name: "White miso", category: "pantry", default_unit: "tbsp", usage: 1, photo: null, updated_at: "2026-04-12T08:00:00Z" },
    { id: "shiitake", name: "Shiitake mushroom", category: "produce", default_unit: "g", usage: 1, photo: null, updated_at: "2026-04-12T09:00:00Z" },
    { id: "greek-yogurt", name: "Greek yogurt", category: "dairy", default_unit: "cup", usage: 1, photo: null, updated_at: "2026-05-01T07:00:00Z" },
    { id: "blood-orange", name: "Blood orange", category: "produce", default_unit: "ea", usage: 1, photo: null, updated_at: "2026-04-18T10:00:00Z" },
    { id: "avocado", name: "Hass avocado", category: "produce", default_unit: "ea", usage: 1, photo: null, updated_at: "2026-04-18T10:30:00Z" },
    { id: "mint", name: "Fresh mint", category: "herbs", default_unit: "leaf", usage: 1, photo: null, updated_at: "2026-04-18T10:45:00Z" },
    { id: "honey", name: "Wildflower honey", category: "pantry", default_unit: "tbsp", usage: 1, photo: null, updated_at: "2026-05-01T07:30:00Z" },
    { id: "berries-mixed", name: "Mixed berries", category: "produce", default_unit: "cup", usage: 1, photo: null, updated_at: "2026-05-01T07:00:00Z" },
    { id: "oats-rolled", name: "Rolled oats", category: "grain", default_unit: "cup", usage: 1, photo: null, updated_at: "2026-05-01T07:00:00Z" },
    { id: "kale", name: "Lacinato kale", category: "produce", default_unit: "leaf", usage: 0, photo: null, updated_at: "2026-04-02T10:00:00Z" },
  ];

  const UTENSILS = [
    { id: "pasta-pot", name: "Large pasta pot", category: "cookware", essential: true, usage: 2, updated_at: "2026-04-22T10:00:00Z" },
    { id: "microplane", name: "Microplane zester", category: "tool", essential: true, usage: 4, updated_at: "2026-04-19T11:00:00Z" },
    { id: "mixing-bowl", name: "Mixing bowl", category: "tool", essential: false, usage: 5, updated_at: "2026-04-15T09:00:00Z" },
    { id: "cast-iron", name: "Cast iron skillet", category: "cookware", essential: true, usage: 1, updated_at: "2026-04-10T08:00:00Z" },
    { id: "rice-cooker", name: "Rice cooker", category: "cookware", essential: false, usage: 1, updated_at: "2026-04-12T10:00:00Z" },
    { id: "fish-spatula", name: "Fish spatula", category: "tool", essential: true, usage: 1, updated_at: "2026-04-19T11:30:00Z" },
    { id: "fine-strainer", name: "Fine-mesh strainer", category: "tool", essential: false, usage: 2, updated_at: "2026-04-18T11:00:00Z" },
    { id: "wooden-spoon", name: "Wooden spoon", category: "tool", essential: false, usage: 6, updated_at: "2026-04-12T08:00:00Z" },
    { id: "small-saucepan", name: "Small saucepan", category: "cookware", essential: true, usage: 2, updated_at: "2026-04-12T08:30:00Z" },
    { id: "chefs-knife", name: "Chef's knife", category: "tool", essential: true, usage: 6, updated_at: "2026-04-30T12:00:00Z" },
    { id: "pestle-mortar", name: "Mortar & pestle", category: "tool", essential: false, usage: 0, updated_at: "2026-03-28T09:00:00Z" },
  ];

  // Blood markers
  const METRIC_DEFS = [
    { id: "iron", name: "Iron", category: "mineral", unit: "µg/dL", normal_min: 60, normal_max: 170 },
    { id: "ferritin", name: "Ferritin", category: "mineral", unit: "ng/mL", normal_min: 30, normal_max: 200 },
    { id: "magnesium", name: "Magnesium", category: "mineral", unit: "mg/dL", normal_min: 1.7, normal_max: 2.2 },
    { id: "zinc", name: "Zinc", category: "mineral", unit: "µg/dL", normal_min: 70, normal_max: 120 },
    { id: "hemoglobin", name: "Hemoglobin", category: "blood", unit: "g/dL", normal_min: 12, normal_max: 17.5 },
    { id: "wbc", name: "White blood cells", category: "blood", unit: "10⁹/L", normal_min: 4, normal_max: 11 },
    { id: "vit-d", name: "Vitamin D (25-OH)", category: "vitamin", unit: "ng/mL", normal_min: 30, normal_max: 100 },
    { id: "vit-b12", name: "Vitamin B12", category: "vitamin", unit: "pg/mL", normal_min: 200, normal_max: 900 },
    { id: "folate", name: "Folate", category: "vitamin", unit: "ng/mL", normal_min: 3, normal_max: 20 },
    { id: "ldl", name: "LDL cholesterol", category: "lipid", unit: "mg/dL", normal_max: 100 },
    { id: "hdl", name: "HDL cholesterol", category: "lipid", unit: "mg/dL", normal_min: 40 },
    { id: "triglycerides", name: "Triglycerides", category: "lipid", unit: "mg/dL", normal_max: 150 },
    { id: "fasting-glucose", name: "Fasting glucose", category: "metabolic", unit: "mg/dL", normal_min: 70, normal_max: 99 },
    { id: "hba1c", name: "HbA1c", category: "metabolic", unit: "%", normal_max: 5.7 },
    { id: "tsh", name: "TSH", category: "thyroid", unit: "mIU/L", normal_min: 0.4, normal_max: 4 },
    { id: "creatinine", name: "Creatinine", category: "kidney", unit: "mg/dL", normal_min: 0.6, normal_max: 1.2 },
  ];

  // Pre-populated marker readings for the demo user
  const MARKERS = {
    iron: { value: 78, measured_at: "2026-03-12", trend: "down" },
    ferritin: { value: 28, measured_at: "2026-03-12", trend: "down" }, // low!
    magnesium: { value: 1.9, measured_at: "2026-03-12", trend: "flat" },
    hemoglobin: { value: 13.2, measured_at: "2026-03-12", trend: "flat" },
    "vit-d": { value: 22, measured_at: "2026-03-12", trend: "down" }, // low!
    "vit-b12": { value: 410, measured_at: "2026-03-12", trend: "up" },
    folate: { value: 8.2, measured_at: "2026-03-12", trend: "flat" },
    ldl: { value: 92, measured_at: "2026-03-12", trend: "down" },
    hdl: { value: 58, measured_at: "2026-03-12", trend: "up" },
    triglycerides: { value: 105, measured_at: "2026-03-12", trend: "flat" },
    "fasting-glucose": { value: 88, measured_at: "2026-03-12", trend: "flat" },
    hba1c: { value: 5.3, measured_at: "2026-03-12", trend: "flat" },
    tsh: { value: 2.1, measured_at: "2026-03-12", trend: "flat" },
  };

  // Recommendations
  const RECOMMENDATIONS = {
    breakfast: [
      { recipe_id: "yogurt-berry", rank: 1, reason: "Quick protein hit before your morning rush." },
      { recipe_id: "quinoa-bowl", rank: 2, reason: "Fiber-forward — pairs well with your low ferritin." },
    ],
    lunch: [
      { recipe_id: "quinoa-bowl", rank: 1, reason: "High-iron quinoa + lemon to boost absorption (your ferritin trend is low)." },
      { recipe_id: "lemon-ricotta", rank: 2, reason: "Light pasta — calcium-rich ricotta for D₃ synergy." },
      { recipe_id: "citrus-avocado", rank: 3, reason: "Vitamin C + healthy fats; a 12-min lunch." },
    ],
    dinner: [
      { recipe_id: "gochujang-salmon", rank: 1, reason: "Vitamin D from salmon — addresses your latest reading." },
      { recipe_id: "miso-mushroom", rank: 2, reason: "Light, warming, low-sodium miso cuts evening cravings." },
    ],
    snack: [
      { recipe_id: "yogurt-berry", rank: 1, reason: "5-minute fix when the 4pm slump hits." },
    ],
  };

  // Active cooking sessions
  const SESSIONS = [
    { recipe_id: "gochujang-salmon", current_step: 2, updated_at: "2026-05-03T19:48:00Z" },
  ];

  // Saved
  const SAVED = ["lemon-ricotta", "quinoa-bowl", "miso-mushroom", "yogurt-berry"];

  // Meal log (last 7 days)
  const MEAL_LOGS = [
    { id: 1, recipe_id: "lemon-ricotta", meal_type: "dinner", servings: 2, logged_at: "2026-05-03T19:30:00Z" },
    { id: 2, recipe_id: "yogurt-berry", meal_type: "breakfast", servings: 1, logged_at: "2026-05-03T08:14:00Z" },
    { id: 3, recipe_id: "quinoa-bowl", meal_type: "lunch", servings: 1, logged_at: "2026-05-02T13:00:00Z" },
    { id: 4, recipe_id: "citrus-avocado", meal_type: "snack", servings: 1, logged_at: "2026-05-02T16:30:00Z" },
    { id: 5, recipe_id: "miso-mushroom", meal_type: "dinner", servings: 2, logged_at: "2026-05-01T20:10:00Z" },
  ];

  // Demo user
  const USER = {
    name: "Aman Rai",
    email: "aman@infroid.com",
    role: "admin",
    initials: "AR",
    streak: 4,
    cookedThisWeek: 5,
  };

  // ---------- helpers ----------
  function recipeById(id) { return RECIPES.find(r => r.id === id); }
  function ingredientById(id) { return INGREDIENTS.find(i => i.id === id); }
  function utensilById(id) { return UTENSILS.find(u => u.id === id); }
  function metricById(id) { return METRIC_DEFS.find(m => m.id === id); }

  function fmtAgo(iso) {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    return d + "d ago";
  }

  function fmtDate(iso, opts) {
    return new Date(iso).toLocaleDateString("en-US", opts || { month: "short", day: "numeric" });
  }

  // Marker status
  function markerStatus(metric, reading) {
    if (!reading) return "missing";
    const v = reading.value;
    const lo = metric.normal_min, hi = metric.normal_max;
    if (lo != null && v < lo) return "low";
    if (hi != null && v > hi) return "high";
    return "ok";
  }

  return {
    RECIPES, INGREDIENTS, UTENSILS, METRIC_DEFS,
    MARKERS, RECOMMENDATIONS, SESSIONS, SAVED, MEAL_LOGS, USER,
    recipeById, ingredientById, utensilById, metricById,
    fmtAgo, fmtDate, markerStatus,
  };
})();
