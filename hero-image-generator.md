# Recipe Hero Image Generator Prompt

Use this prompt when generating or regenerating a finished-dish hero image for any MyFoodCraving recipe bundle.

## Prompt

You are generating a premium finished-dish hero image for a MyFoodCraving recipe page.

Important:
- Hero images are always square.
- Generate the image as a 1:1 square composition from the start.
- Do not generate a 16:9 landscape image and crop it later.

- Input:
  - Recipe JSON path: `{RECIPE_JSON_PATH}`
  - Output image: `data/recipe-bundles/{recipe-id}/hero.jpg`

- Read the recipe JSON before generating anything:
  - Use `id`, `name`, `cuisine`, `tagline`, `servings`, `ingredients[]`, `utensils[]`, `steps[]`, and `media.hero`.
  - Treat the JSON as the source of truth.
  - Show the finished dish exactly as it should look after the final step.
  - Use only ingredients, garnishes, sauces, sides, and serving pieces supported by the JSON or strongly standard for the cuisine.
  - Do not add random herbs, vegetables, breads, rice, sauces, table props, or cutlery.

- Visual direction:
  - Photorealistic editorial food photography.
  - The dish must be served in a real plate, shallow bowl, deep bowl, platter, or thali that suits the recipe.
  - Use the homepage dish pattern: a clean, centered plate or bowl on a warm cream or light stone surface, photographed from overhead or three-quarter overhead.
  - Make the food tempting, generous, fresh, glossy, aromatic, and delicious without looking synthetic.
  - Prefer warm natural window light, soft shadows, realistic highlights, and appetizing texture.
  - Keep the styling premium but practical: restrained props, clean surface, no clutter.
  - The hero should feel brighter, cleaner, and more plate-forward than a dark restaurant tabletop shot.

- Composition:
  - 1:1 square image for recipe hero placement.
  - Center the finished dish in a plate or bowl with generous safe margins for responsive cropping.
  - The plate or bowl should be the first visual read.
  - Food should fill the vessel attractively without spilling or looking overpacked.
  - Use a camera angle that makes the serving vessel clear: overhead for bowls and composed plates, three-quarter overhead for tall or textured dishes.
  - Keep the main food detail away from extreme edges.
  - No text, logos, labels, hands, faces, packaging, UI, recipe cards, or watermarks.

- Dish accuracy:
  - Respect the cuisine, cooking method, doneness, and final plating described by the recipe.
  - Respect vegetarian or non-vegetarian identity.
  - Indian recipes should look culturally appropriate and not westernized unless the recipe says so.
  - Curries should look like curries, dry sabzis should look dry, rice dishes should show distinct grains, breads should show correct puff or crispness, and grilled items should show realistic char.
  - Garnishes and accompaniments must match the final step or `ingredients[]`.
  - Do not confuse similar foods: paneer vs tofu, chicken vs paneer, dal vs rajma, dosa vs roti, bhature vs puri, biryani vs pulao.

- Texture and appetite cues:
  - Show real food texture: char, browning, steam, gloss, oil sheen, creamy gravy, crisp edges, tender pieces, separated grains, or fresh garnish as appropriate.
  - Make colors vivid but natural.
  - Avoid plastic shine, neon color, painted-looking sauces, fake grill marks, mushy detail, and overprocessed smoothing.
  - The dish should look freshly served and ready to eat.

- Prompt structure:
  - `Use case: photorealistic-natural`
  - `Asset type: MyFoodCraving finished recipe hero image, 1:1 square`
  - `Recipe JSON: {RECIPE_JSON_PATH}`
  - `Recipe: {recipe.name}`
  - `Cuisine: {recipe.cuisine}`
  - `Finished dish: {final serving state from recipe}`
  - `Serving vessel: {plate, shallow bowl, deep bowl, platter, thali}`
  - `Required visible items: {finished dish, garnish, sauce, sides from recipe}`
  - `Forbidden visible items: {unsupported ingredients, future/process tools, clutter}`
  - `Composition: centered plate/bowl, homepage dish pattern, warm light, safe margins`
  - `Texture/doneness: {charred, creamy, crisp, glossy, steamed, etc.}`
  - `Negative constraints: {negative prompt}`

- Negative prompt for every hero:
  - No text, subtitles, labels, logos, watermark, UI, recipe card, hands, face, packaging, brand names, dirty counter, messy sink, plastic containers, random props, unrelated ingredients, extra sauces, extra breads, cartoon style, illustration, CGI, surreal food, impossible food physics, distorted bowl, warped plate, malformed cutlery, duplicated items, fake grill marks, neon colors, harsh flash, flat lighting, excessive blur, cropped-off dish, dark moody restaurant scene.

- Quality check before accepting:
  - The file dimensions are square.
  - The dish is clearly served in a plate or bowl.
  - The plating resembles the homepage dish pattern while staying appropriate for the recipe.
  - The image is tempting, delicious, and photorealistic.
  - The recipe identity is recognizable at a glance.
  - The hero matches the recipe ingredients and final step.
  - The image remains strong as a square card and under responsive cropping.
  - The background is clean and does not compete with the dish.
  - Reject and regenerate if the food looks synthetic, inaccurate, cluttered, too dark, or not plate/bowl-forward.

- Output:
  - Save the final image as `data/recipe-bundles/{recipe-id}/hero.jpg`.
  - Keep `media.hero.src` pointing to `data/recipe-bundles/{recipe-id}/hero.jpg`.
  - Update `media.hero.alt` and `media.hero.caption` only if the visible plating meaningfully changes.
  - Verify in the browser or by direct file inspection that the image loads.
