/* Mock data: 48 recipes, ~30 ingredients, ~20 utensils, users, etc. */

const CUISINES = ["Indian", "South Indian", "Italian", "Japanese", "Mediterranean", "Mexican", "Thai", "Korean", "French", "American", "Levantine", "Vietnamese"];
const DIFFS = ["Easy", "Medium", "Hard"];
const TAGS_VEG = ["vegetarian", "vegan", "gluten-free", "high-fiber", "high-protein"];
const TAGS_OTHER = ["non-veg", "iron-rich", "quick", "comfort", "festive", "weeknight", "low-carb"];
const EMOJI = ["🍛", "🍜", "🍲", "🥘", "🍝", "🥗", "🍱", "🍣", "🌮", "🥙", "🍕", "🍳", "🥟", "🍤", "🍢", "🍙"];

const RECIPE_NAMES = [
  "Saffron Butter Biryani", "Lemon Ricotta Spaghetti", "Gochujang Salmon Rice", "Citrus Avocado Salad",
  "Greek Yogurt Berry Cup", "Mediterranean Quinoa Bowl", "Miso Mushroom Soup", "Tomato Confit Tartine",
  "Brown Butter Dal Tadka", "Smoky Paneer Tikka", "Crispy Mushroom Tacos", "Black Garlic Ramen",
  "Charred Eggplant Babaganoush", "Coconut Lentil Curry", "Tahini Roasted Carrots", "Spiced Apple Galette",
  "Burnt Honey Halloumi", "Fennel Orange Salad", "Whipped Feta Crostini", "Sesame Soba Bowl",
  "Bay Leaf Risotto", "Black Pepper Tofu", "Ginger Scallion Noodles", "Pomegranate Glazed Chicken",
  "Burrata Stone Fruit", "Pistachio Pesto Pasta", "Charred Broccoli Caesar", "Rosewater Almond Cake",
  "Sumac Tomato Salad", "Brown Butter Carbonara", "Hot Honey Chickpeas", "Herb Yogurt Flatbread",
  "Caramelized Shallot Pasta", "Smoked Paprika Eggs", "Maple Roast Squash", "Olive Oil Granola",
  "Brown Butter Mushrooms", "Coriander Carrot Soup", "Bay Leaf Mussels", "Charred Pepper Hummus",
  "Black Sesame Cookies", "Saffron Pannacotta", "Whipped Honey Tahini", "Butter Beans + Chard",
  "Charred Lemon Salmon", "Sweet Potato Tacos", "Yuzu Cucumber Salad", "Matcha Tres Leches"
];

function rand(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const RECIPES = RECIPE_NAMES.map((name, i) => {
  const r1 = rand(i * 7 + 1);
  const r2 = rand(i * 11 + 3);
  const r3 = rand(i * 13 + 5);
  const isVeg = r1 > 0.3;
  const tags = [];
  if (isVeg) tags.push("vegetarian"); else tags.push("non-veg");
  if (r2 > 0.7) tags.push("vegan");
  if (r2 > 0.5) tags.push("gluten-free");
  if (r3 > 0.6) tags.push("high-protein");
  if (r3 > 0.7) tags.push("quick");
  const minutes = 10 + Math.floor(r1 * 60);
  return {
    id: "r" + (i + 1),
    name,
    cuisine: CUISINES[Math.floor(r2 * CUISINES.length)],
    difficulty: DIFFS[Math.floor(r3 * 3)],
    totalMinutes: minutes,
    emoji: EMOJI[i % EMOJI.length],
    tags,
    chef: ["Anna Park", "Ravi Mehta", "Lina Tov", "Marco Rossi", "Yuki Sato"][i % 5],
    saved: r1 > 0.7,
    status: r3 > 0.85 ? "draft" : "published",
    updated: ["2d ago", "5d ago", "1w ago", "2w ago", "1mo ago"][i % 5],
    views: Math.floor(r2 * 9000) + 200,
  };
});

const INGREDIENTS = [
  { id: "i1", name: "Spinach, raw", category: "Vegetable", emoji: "🥬", usage: 12, allergens: [] },
  { id: "i2", name: "Salmon, Atlantic, farmed", category: "Fish", emoji: "🐟", usage: 6, allergens: ["fish"] },
  { id: "i3", name: "Greek yogurt, whole milk", category: "Dairy", emoji: "🥛", usage: 9, allergens: ["dairy"] },
  { id: "i4", name: "Almonds, raw", category: "Nut", emoji: "🌰", usage: 5, allergens: ["nuts"] },
  { id: "i5", name: "Quinoa, dry", category: "Grain", emoji: "🌾", usage: 8, allergens: [] },
  { id: "i6", name: "Avocado, Hass", category: "Fruit", emoji: "🥑", usage: 11, allergens: [] },
  { id: "i7", name: "Lentils, brown, dry", category: "Legume", emoji: "🫘", usage: 7, allergens: [] },
  { id: "i8", name: "Olive oil, extra virgin", category: "Oil", emoji: "🫒", usage: 38, allergens: [] },
  { id: "i9", name: "Lemon, raw", category: "Fruit", emoji: "🍋", usage: 22, allergens: [] },
  { id: "i10", name: "Garlic, raw", category: "Aromatic", emoji: "🧄", usage: 31, allergens: [] },
  { id: "i11", name: "Tomato, ripe", category: "Vegetable", emoji: "🍅", usage: 24, allergens: [] },
  { id: "i12", name: "Paneer", category: "Dairy", emoji: "🧀", usage: 5, allergens: ["dairy"] },
  { id: "i13", name: "Tofu, firm", category: "Soy", emoji: "🟦", usage: 6, allergens: ["soy"] },
  { id: "i14", name: "Brown rice, dry", category: "Grain", emoji: "🍚", usage: 9, allergens: [] },
  { id: "i15", name: "Chickpeas, cooked", category: "Legume", emoji: "🟡", usage: 7, allergens: [] },
  { id: "i16", name: "Ginger, fresh", category: "Aromatic", emoji: "🫚", usage: 14, allergens: [] },
];

// FDC-shaped nutrition for spinach (showing high-density layout works)
const SPINACH_NUTRITION = {
  basis: "100 g, raw",
  source: "USDA FoodData Central · SR Legacy 168462",
  calories: 23,
  macros: { protein: 2.86, fat: 0.39, carbs: 3.63, fiber: 2.2, sugars: 0.42, water: 91.4 },
  groups: [
    {
      name: "General",
      rows: [
        ["Energy", 23, "kcal", 1.2],
        ["Water", 91.4, "g", null],
        ["Protein", 2.86, "g", 5.7],
        ["Total fat", 0.39, "g", 0.5],
        ["Carbohydrate", 3.63, "g", 1.3],
        ["Fiber, total", 2.2, "g", 7.9],
        ["Sugars, total", 0.42, "g", null],
        ["Ash", 1.72, "g", null],
      ]
    },
    {
      name: "Minerals",
      rows: [
        ["Calcium, Ca", 99, "mg", 7.6],
        ["Iron, Fe", 2.71, "mg", 15.0, "high"],
        ["Magnesium, Mg", 79, "mg", 19.0, "high"],
        ["Phosphorus, P", 49, "mg", 3.9],
        ["Potassium, K", 558, "mg", 11.9, "high"],
        ["Sodium, Na", 79, "mg", 3.4],
        ["Zinc, Zn", 0.53, "mg", 4.8],
        ["Copper, Cu", 0.13, "mg", 14.4],
        ["Manganese, Mn", 0.897, "mg", 39.0, "high"],
        ["Selenium, Se", 1.0, "µg", 1.8],
      ]
    },
    {
      name: "Vitamins",
      rows: [
        ["Vitamin C", 28.1, "mg", 31.2, "high"],
        ["Thiamin (B1)", 0.078, "mg", 6.5],
        ["Riboflavin (B2)", 0.189, "mg", 14.5],
        ["Niacin (B3)", 0.724, "mg", 4.5],
        ["Pantothenic acid", 0.065, "mg", 1.3],
        ["Vitamin B6", 0.195, "mg", 11.5],
        ["Folate, total", 194, "µg", 48.5, "high"],
        ["Choline", 19.3, "mg", 3.5],
        ["Vitamin A, RAE", 469, "µg", 52.1, "high"],
        ["Vitamin E", 2.03, "mg", 13.5],
        ["Vitamin K", 482.9, "µg", 402, "warn"],
      ]
    },
    {
      name: "Lipids",
      rows: [
        ["Saturated", 0.063, "g", 0.3],
        ["Monounsaturated", 0.010, "g", null],
        ["Polyunsaturated", 0.165, "g", null],
        ["Omega-3 (ALA)", 0.138, "g", null],
        ["Omega-6", 0.026, "g", null],
        ["Cholesterol", 0, "mg", 0],
      ]
    },
    {
      name: "Amino acids",
      rows: [
        ["Tryptophan", 0.039, "g", null],
        ["Threonine", 0.122, "g", null],
        ["Isoleucine", 0.147, "g", null],
        ["Leucine", 0.223, "g", null],
        ["Lysine", 0.174, "g", null],
        ["Methionine", 0.053, "g", null],
        ["Phenylalanine", 0.129, "g", null],
        ["Tyrosine", 0.108, "g", null],
        ["Valine", 0.161, "g", null],
        ["Arginine", 0.162, "g", null],
        ["Histidine", 0.064, "g", null],
        ["Alanine", 0.142, "g", null],
        ["Aspartic acid", 0.24, "g", null],
        ["Glutamic acid", 0.343, "g", null],
        ["Glycine", 0.134, "g", null],
        ["Proline", 0.112, "g", null],
        ["Serine", 0.104, "g", null],
      ]
    },
  ]
};

const UTENSILS = [
  { id: "u1", name: "Cast iron skillet, 12\"", category: "Pan", emoji: "🍳", price: "$45–$80", uses: 18 },
  { id: "u2", name: "Dutch oven, 5.5 qt", category: "Pot", emoji: "🥘", price: "$120–$300", uses: 14 },
  { id: "u3", name: "Chef's knife, 8\"", category: "Knife", emoji: "🔪", price: "$60–$200", uses: 47 },
  { id: "u4", name: "Microplane zester", category: "Tool", emoji: "🪒", price: "$15", uses: 21 },
  { id: "u5", name: "Bench scraper", category: "Tool", emoji: "▭", price: "$10", uses: 9 },
  { id: "u6", name: "Wooden spatula", category: "Tool", emoji: "🥄", price: "$8", uses: 28 },
  { id: "u7", name: "Sheet pan, half", category: "Bake", emoji: "▢", price: "$20", uses: 22 },
  { id: "u8", name: "Mixing bowls, set of 3", category: "Prep", emoji: "🥣", price: "$25", uses: 33 },
];

const USERS = [
  { id: "u1", name: "Alex Chen", email: "alex@gmail.com", role: "user", joined: "Mar 2026", saves: 14, last: "today" },
  { id: "u2", name: "Anna Park", email: "anna.park@mfc.com", role: "chef", joined: "Jan 2026", saves: 8, last: "2h ago" },
  { id: "u3", name: "Ravi Mehta", email: "ravi.m@mfc.com", role: "chef", joined: "Dec 2025", saves: 23, last: "yesterday" },
  { id: "u4", name: "Casey Liu", email: "casey@gmail.com", role: "user", joined: "Apr 2026", saves: 3, last: "5d ago" },
  { id: "u5", name: "Jordan Smith", email: "jordan@mfc.com", role: "admin", joined: "Oct 2025", saves: 0, last: "now" },
  { id: "u6", name: "Marco Rossi", email: "marco.r@mfc.com", role: "chef", joined: "Feb 2026", saves: 12, last: "1w ago" },
  { id: "u7", name: "Lina Tov", email: "lina@mfc.com", role: "chef", joined: "Mar 2026", saves: 7, last: "today" },
  { id: "u8", name: "Sam Wright", email: "sam@gmail.com", role: "user", joined: "Apr 2026", saves: 0, last: "3w ago" },
];

Object.assign(window, {
  RECIPES, INGREDIENTS, UTENSILS, USERS, SPINACH_NUTRITION,
  CUISINES, DIFFS, TAGS_VEG, TAGS_OTHER,
});
