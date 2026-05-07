# Recipe Image Generator Prompt

Use this prompt when generating a complete image set for any MyFoodCraving recipe JSON file.

## Prompt

You are generating a consistent, accurate, high-end food photography image set for a recipe page.

- Input:
  - Recipe JSON path: `{RECIPE_JSON_PATH}`
  - Output folder: `web/assets/recipes/{recipe-id}/`
  - Required assets:
    - 1 hero image for the finished recipe.
    - 1 image for every item in `steps[]`.

- Agent-mode rule:
  - Work one recipe at a time.
  - Generate one large master image for that recipe first.
  - Crop the master into the final hero and step files with Python.
  - Update `recipe.json`.
  - Validate files, JSON metadata, dimensions, and browser rendering.
  - Move to the next recipe only after the current recipe passes.
  - Do not generate hero and step images one after another unless the master
    workflow fails after a targeted retry.
  - Do not mix assets from different generations for one recipe unless the user
    explicitly accepts the continuity break.

- Read the recipe JSON before generating anything:
  - Use `id`, `name`, `cuisine`, `tagline`, `ingredients[]`, `utensils[]`, and every object in `steps[]`.
  - Treat the JSON as the source of truth.
  - Do not add ingredients, garnishes, cookware, serving items, or preparation actions that are not supported by the JSON or strongly implied by the cuisine and step text.
  - Do not skip steps.
  - Do not merge multiple steps into one image.
  - Do not make every step look like the finished dish.

- Read the website design context before generating hero images:
  - Inspect `design/tokens.css`, `design/styles/pages.css`, and
    `design/styles/recipe.css` for the current visual system.
  - Match the site's warm paper/cream backgrounds, ink borders, flat pop
    shadows, orange/matcha/butter accents, serif editorial tone, and compact
    rounded cards.
  - Food photos should feel tactile, warm, appetizing, and premium against that
    design system. Avoid cold stock-photo lighting, flat beige-on-beige food,
    harsh commercial flash, and overly dark restaurant photography.
  - Use recipe colors and ingredients to create a clear first-read color signal
    that works inside cream cards and ink borders.

- First create a continuity bible for the whole recipe:
  - Define one fixed kitchen environment used across all images.
  - Define one fixed surface, backdrop, lighting direction, camera angle family, lens feel, crop ratio, color temperature, and depth of field.
  - Define the exact recurring cookware and utensils from `utensils[]`.
  - Define the exact recurring bowls, plates, towels, spoons, spice bowls, and small props.
  - Define premium serviceware and utensils: attractive but plausible glasses,
    bowls, plates, spoons, ladles, strainers, boards, and serving vessels that
    match the cuisine and the website's high-end editorial style.
  - Prefer cut-crystal or hand-blown glassware for drinks, hand-thrown ceramic
    bowls, hammered brass/copper spice bowls, polished stainless cookware, and
    warm wood or brass tools where culturally appropriate.
  - Avoid cheap generic tumblers, disposable cups, dull plastic utensils,
    cafeteria-style plates, or visually forgettable cookware unless the recipe
    explicitly requires them.
  - Keep prop count restrained and practical.
  - Reuse the same pan/kadhai/pot/tawa/blender/strainer/serving vessel throughout the relevant steps.
  - If a utensil appears in multiple steps, it must look like the same object each time.
  - If an ingredient appears in multiple steps, it must keep a consistent cut size, color, and visual identity.
  - If the recipe includes a final garnish or finishing ingredient, reserve it for the correct final step and hero unless earlier steps explicitly use it.
  - Define an explicit scale lock for recurring objects: approximate vessel
    sizes, glass heights, bowl diameters, mango/vegetable sizes, spoon length,
    pan diameter, and camera distance. Keep those sizes visually consistent
    across hero and every step.

- Preferred generation strategy for consistency:
  - Strongly prefer a single large master contact-sheet image for the whole
    recipe.
  - The master-first workflow is the default for agent mode because it gives the
    model one continuity bible, one lighting setup, one prop set, and one scale
    lock for the complete recipe.
  - Avoid independent one-by-one generation. It usually causes cookware,
    countertop, camera distance, color grade, garnish timing, and object scale
    drift.
  - Use one simple, deterministic grid:
    - Panel 1: hero, finished recipe.
    - Panel 2: step 1.
    - Panel 3: step 2.
    - Continue in `steps[]` order.
  - Prefer equal-size square panels in the master:
    - Crop the hero panel as full 1:1.
    - Crop every step panel as a centered 16:9 landscape crop.
    - Prompt every step panel to keep the action/result in the center 70% so the
      16:9 crop is safe.
  - If the model reliably supports mixed-aspect panels at the requested size,
    an alternate master may use one square 1:1 hero panel and one 16:9 panel for
    every step. Keep the panel order identical.
  - Use no text, labels, numbers, watermarks, decorative borders, or UI chrome.
  - Thin neutral gutters are allowed only if the crop script can remove them
    cleanly.
  - Keep the same camera height, lens feel, object scale, serviceware,
    countertop, background, lighting direction, and color grade in every panel.
  - Each panel must show only its own recipe state. Do not merge steps
    semantically even though they are generated together.
  - Crop the master with a deterministic Python image-processing script into
    `hero.jpg` and the `step-XX-{slug}.jpg` files.
  - Verify every crop before accepting it.
  - Regenerate the full master when continuity, ingredient timing, or panel
    accuracy is wrong.
  - Generate an individual replacement only as a fallback when:
    - The master is otherwise accepted.
    - One panel is unusable.
    - The replacement prompt repeats the exact continuity bible and scale lock.
    - The visual mismatch is acceptable after inspection.

- Crop-script requirements:
  - Use Python with Pillow or another structured image library.
  - Do not crop manually with screenshots or image-editor guesswork.
  - Inputs:
    - Master image path.
    - Recipe JSON path.
    - Output folder.
    - Panel layout: columns, rows, gutter size, panel order.
  - Outputs:
    - `hero.jpg`
    - `step-01-{short-step-slug}.jpg`
    - `step-02-{short-step-slug}.jpg`
    - Continue until every `steps[]` item has a crop.
  - Convert final files to JPEG.
  - Use consistent quality, ideally 88-92.
  - Strip the gutters.
  - For square-panel masters:
    - Save hero as the full first square panel.
    - Save steps from the center 16:9 crop of each step panel.
  - For mixed-aspect masters:
    - Save each panel at its native aspect ratio.
  - Fail closed:
    - If a panel count does not match `1 + steps.length`, stop.
    - If the hero is not square, stop.
    - If any step is not 16:9 after crop, stop.
    - If any output would be below the minimum dimensions, stop.
  - Minimum dimensions:
    - Hero: at least `1024x1024`.
    - Step images: at least `1280x720`.

- Agent-mode execution workflow:
  - Read the recipe JSON first.
  - Read `design/tokens.css`, `design/styles/pages.css`, and
    `design/styles/recipe.css`.
  - Build the continuity bible from the JSON.
  - Build the panel map from `steps[]`.
  - Generate the master image.
  - Copy the generated master from the image tool output into a temporary
    workspace path for cropping.
  - Built-in image generation usually saves under
    `$CODEX_HOME/generated_images/...`; copy the selected image from there and
    leave the original in place.
  - Do not reference the master image from `recipe.json`.
  - Run the crop script.
  - Inspect the master and all crops.
  - Update `recipe.json`.
  - Validate with a script:
    - `media.hero.src` exists.
    - `media.hero.alt` exists.
    - `media.hero.caption` exists.
    - Every `steps[i].media.src` exists.
    - Every `steps[i].media.alt` exists.
    - Every `steps[i].media.caption` exists.
    - Every referenced local image file exists.
    - Hero dimensions are square.
    - Step dimensions are 16:9.
  - Verify in the browser.
  - If browser detail pages use Supabase metadata for the tested recipe, push
    only that recipe before browser verification:
    - `uv --project automation run mfc sync-images --direction push --recipe {recipe-id}`
    - `uv --project automation run mfc sync-recipes --direction push --recipe {recipe-id}`
  - Do not run broad all-recipe sync commands during image generation unless
    the user explicitly asks.

- Overall visual style:
  - Photorealistic editorial food photography.
  - Premium Indian home-kitchen styling, warm and appetizing, never synthetic.
  - Hero output is square 1:1.
  - Step output is 16:9 landscape.
  - Master panels must be safe for those final crops.
  - Three-quarter overhead camera angle unless a step needs a lower angle for clarity.
  - Warm natural window light from the same direction in every image.
  - Realistic steam, gloss, oil separation, browning, texture, and moisture.
  - Clean background with generous safe margins for UI cropping.
  - No text, labels, logos, watermarks, hands, faces, packaging, brand names, or decorative clutter.
  - No impossible food physics, floating items, duplicated tools, malformed cookware, or random extra ingredients.

- Hero image requirements:
  - Generate `hero.jpg` as a square 1:1 image, not a landscape image.
  - Show the finished dish exactly as the recipe should look when served.
  - Use the same environment, surface, light, props, and final serving vessel from the continuity bible.
  - Include only serving accompaniments that are explicitly mentioned in the recipe or highly standard for the dish.
  - Make the dish recognizable at a glance.
  - Hero must look more polished than step images, but still belong to the same shoot.
  - Hero must not include intermediate process tools unless they are intentionally styled in the background.
  - Design for every website surface — all are square (1:1):
    - Recipe detail hero: large rounded frame, `object-fit: cover`,
      save button overlays the top-right corner.
    - Recipe search card: top-left heart, top-right preference badge,
      bottom-left cuisine pill, dark gradient along the bottom.
    - Dashboard saved cards: square cover, top-right heart.
    - Dashboard recommendation + marker thumbs: small square crops
      down to `36x36`.
    - Admin/chef edit hero: square cover with overlay edit pill.
  - Keep the finished dish or drink in the central 60% of the square so it
    remains legible in tiny thumbnails.
  - Keep all critical food detail out of overlay zones: top-left 14%,
    top-right 18%, bottom-left 22%, and bottom 16% of the square.
  - Compose so center 4:3 and center 16:9 crops also read well — defensive
    composition for any future non-square surface. Put non-critical props
    near the edges; never put the main dish, garnish, pour, cut face, or
    hero glass only at an edge.
  - Leave enough breathing room around the subject for the site's ink border,
    rounded corners, hover zoom, and pop-shadow treatment.
  - Use premium serviceware in the hero first. The hero is the sales image:
    glasses, plates, bowls, boards, spoons, and serving vessels should be the
    most attractive version used in the series while staying plausible.

- Step image requirements:
  - Each step image must show only the state of the recipe at that exact step.
  - The main subject must be the action/result described by `step.title` and `step.detail`.
  - Earlier steps should look unfinished when the recipe is unfinished.
  - Later steps must visibly build on earlier steps.
  - Use the correct utensil for the step, chosen from `utensils[]`.
  - Show the exact ingredients being added, cooked, blended, strained, rested, garnished, or served in that step.
  - Do not show final plating before the final serving/resting step.
  - Do not show raw ingredients after they should have been cooked unless the step says to add them then.
  - Do not show cream, garnish, paneer, chicken, rice, bread, or other finishing elements before the recipe text introduces them.
  - If the step is about texture, make that texture obvious: jammy, silky, charred, foamy, crisp, thick, glossy, separated oil, bubbling, rested, or folded.
  - If the step uses time or heat, show the correct visual consequence: char, simmer bubbles, softened vegetables, reduced gravy, set batter, puffed bread, steamed rice, or rested sauce.

- Consistency constraints:
  - Generate the images as one series, not as independent food photos.
  - Keep the same visual grammar in every prompt.
  - Keep the same countertop, background, light direction, prop set, and cookware identity.
  - Keep recurring object sizes consistent: the same glass, bowl, pan, spoon,
    mango, utensil, and serving vessel must not grow or shrink between images.
  - Keep color grading consistent across hero and steps.
  - Keep serving size visually consistent with `servings`.
  - Keep ingredient quantities visually plausible.
  - Keep vessel size plausible for the quantity being cooked.
  - Keep camera distance similar enough that the UI feels coherent when stepping through images.
  - If hands are absolutely necessary for clarity, show only the same neutral adult hands, no jewelry, no sleeves with patterns, and use hands sparingly.
  - Prefer no hands when the process is understandable without them.

- Accuracy constraints:
  - Indian dishes must use culturally appropriate cookware and preparation states.
  - Do not westernize the dish unless the JSON says so.
  - Do not plate a curry like a soup, salad, pasta, or stew unless appropriate.
  - Do not confuse similar dishes: paneer vs tofu, chicken vs paneer, dal vs rajma, dosa vs roti, bhature vs puri, biryani vs pulao.
  - Respect vegetarian/non-vegetarian identity from ingredients.
  - Respect cooking method from the step: sear, grill, simmer, fry, blend, strain, steam, rest, fold, garnish, or serve.
  - Respect doneness: raw, marinated, partially cooked, fully cooked, reduced, strained, finished.

- Negative prompt for every image:
  - No text, subtitles, labels, logos, watermark, UI, recipe card, measuring annotations, brand packaging, human face, messy sink, dirty counter, plastic containers, cartoon style, illustration, CGI, surreal food, extra unrelated ingredients, inconsistent utensils, wrong cookware, overfilled pan, impossible perspective, duplicated handles, distorted bowls, malformed spoons, melted plates, artificial neon colors, harsh flash, flat lighting, excessive blur, cropped-off main subject.

- Output naming:
  - Recipe data: `recipe.json`
  - Hero: `hero.jpg` (square 1:1)
  - Steps:
    - `step-01-{short-step-slug}.jpg`
    - `step-02-{short-step-slug}.jpg`
    - Continue until every `steps[]` item has an image.
  - Use lowercase slugs.
  - Use short descriptive slugs based on the step title.

- Output metadata to write back into the recipe JSON:
  - For hero:
    - `media.hero.src`
    - `media.hero.alt`
    - `media.hero.caption`
  - For every step:
    - `steps[i].media.src`
    - `steps[i].media.alt`
    - `steps[i].media.caption`
  - Alt text must describe the visible cooking state, not repeat the title.
  - Captions must be short, concrete, and useful in the UI.
  - Local image `src` values must point into the recipe bundle, for example
    `assets/recipes/{recipe-id}/hero.jpg`.
  - Supabase sync normalizes local `assets/...` image values to Storage URLs on
    push.

- Prompt structure for each generated image:
  - Use only for fallback individual replacements.
  - Prefer the master contact-sheet prompt for normal agent-mode work.
  - `Use case: photorealistic-natural`
  - `Asset type: MyFoodCraving recipe {hero|step} image, {square 1:1 hero|16:9 landscape step}`
  - `Recipe: {recipe.name}`
  - `Image: {hero|step number and title}`
  - `Website crop targets: {hero detail 1:1, search card 1:1, dashboard thumb 1:1, saved card 4:3, admin preview 16:9}`
  - `Continuity bible: {fixed environment, lighting, surface, recurring cookware, recurring props}`
  - `Serviceware and utensils: {premium recurring glasses, bowls, plates, cookware, spoons, strainers, and serving vessels}`
  - `Scale lock: {fixed relative sizes for recurring objects and camera distance}`
  - `Subject: {exact visible food state}`
  - `Required visible items: {ingredients and utensils required for this asset}`
  - `Forbidden visible items: {future ingredients, future tools, unrelated props, finished dish if not final}`
  - `Composition: {camera angle, crop, safe margins, focal subject, overlay-safe zones}`
  - `Texture/doneness: {raw/cooked/reduced/charred/silky/etc.}`
  - `Negative constraints: {full negative prompt}`

- Prompt structure for a master contact sheet:
  - `Use case: photorealistic-natural`
  - `Asset type: MyFoodCraving complete recipe image master, crop source`
  - `Recipe: {recipe.name}`
  - `Layout: one large contact sheet with equal-size square panels, no text, labels, numbers, watermarks, or borders`
  - `Panel map: panel 1 hero; panel 2 step 1; panel 3 step 2; ...`
  - `Crop plan: crop panel 1 full square as hero.jpg; crop panels 2..N as centered 16:9 step images`
  - `Website crop targets for hero: detail 1:1, search card 1:1, dashboard thumb 1:1, saved card 4:3, admin preview 16:9`
  - `Continuity bible: {fixed environment, lighting, surface, recurring cookware, recurring props}`
  - `Serviceware and utensils: {premium recurring glasses, bowls, plates, cookware, spoons, strainers, and serving vessels}`
  - `Scale lock: {fixed relative sizes for recurring objects and camera distance}`
  - `Panel subjects: {one precise subject per panel}`
  - `Required visible items by panel: {ingredients and utensils required for each crop}`
  - `Forbidden visible items by panel: {future ingredients, future tools, unrelated props}`
  - `Composition: each panel is crop-safe; hero fills a square crop; every step keeps the action/result inside the center 70% for a clean 16:9 crop; matching camera distance`
  - `Negative constraints: {full negative prompt}`

- Quality check before accepting images:
  - Every image matches the corresponding recipe step.
  - The same recurring utensils look consistent across the full set.
  - Premium serviceware and utensils are visible where they improve the image,
    but they do not add clutter or unsupported recipe items.
  - Recurring object scale stays stable across all crops.
  - No step shows ingredients or finishing elements too early.
  - No step accidentally looks like the hero unless it is the final serving step.
  - The hero accurately represents the finished recipe.
  - The hero is square and remains strong in all site crops: 1:1, 4:3, 16:9,
    and tiny square thumbnails.
  - The hero's main subject does not sit under the search-card heart,
    preference badge, cuisine pill, bottom gradient, or recipe-page save button.
  - The set looks like one coherent shoot.
  - The UI caption area does not cover critical food detail.
  - The image remains clear when cropped into a 16:9 card.
  - Reject and regenerate any image that violates continuity, accuracy, or ingredient timing.

- Final deliverable:
  - Save `recipe.json`, `hero.jpg`, and all step images in the recipe bundle folder.
  - Update the recipe JSON with the final `src`, `alt`, and `caption` values.
  - Keep the generic recipe template able to load `assets/recipes/{recipe-id}/recipe.json` in local preview.
  - Verify in the browser that hero and every step image load correctly.
