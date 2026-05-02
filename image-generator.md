# Recipe Image Generator Prompt

Use this prompt when generating a complete image set for any MyFoodCraving recipe JSON file.

## Prompt

You are generating a consistent, accurate, high-end food photography image set for a recipe page.

- Input:
  - Recipe JSON path: `{RECIPE_JSON_PATH}`
  - Output folder: `data/recipe-bundles/{recipe-id}/`
  - Required assets:
    - 1 hero image for the finished recipe.
    - 1 image for every item in `steps[]`.

- Read the recipe JSON before generating anything:
  - Use `id`, `name`, `cuisine`, `tagline`, `ingredients[]`, `utensils[]`, and every object in `steps[]`.
  - Treat the JSON as the source of truth.
  - Do not add ingredients, garnishes, cookware, serving items, or preparation actions that are not supported by the JSON or strongly implied by the cuisine and step text.
  - Do not skip steps.
  - Do not merge multiple steps into one image.
  - Do not make every step look like the finished dish.

- First create a continuity bible for the whole recipe:
  - Define one fixed kitchen environment used across all images.
  - Define one fixed surface, backdrop, lighting direction, camera angle family, lens feel, crop ratio, color temperature, and depth of field.
  - Define the exact recurring cookware and utensils from `utensils[]`.
  - Define the exact recurring bowls, plates, towels, spoons, spice bowls, and small props.
  - Keep prop count restrained and practical.
  - Reuse the same pan/kadhai/pot/tawa/blender/strainer/serving vessel throughout the relevant steps.
  - If a utensil appears in multiple steps, it must look like the same object each time.
  - If an ingredient appears in multiple steps, it must keep a consistent cut size, color, and visual identity.
  - If the recipe includes a final garnish or finishing ingredient, reserve it for the correct final step and hero unless earlier steps explicitly use it.

- Overall visual style:
  - Photorealistic editorial food photography.
  - Premium Indian home-kitchen styling, warm and appetizing, never synthetic.
  - 16:9 landscape composition.
  - Three-quarter overhead camera angle unless a step needs a lower angle for clarity.
  - Warm natural window light from the same direction in every image.
  - Realistic steam, gloss, oil separation, browning, texture, and moisture.
  - Clean background with generous safe margins for UI cropping.
  - No text, labels, logos, watermarks, hands, faces, packaging, brand names, or decorative clutter.
  - No impossible food physics, floating items, duplicated tools, malformed cookware, or random extra ingredients.

- Hero image requirements:
  - Show the finished dish exactly as the recipe should look when served.
  - Use the same environment, surface, light, props, and final serving vessel from the continuity bible.
  - Include only serving accompaniments that are explicitly mentioned in the recipe or highly standard for the dish.
  - Make the dish recognizable at a glance.
  - Hero must look more polished than step images, but still belong to the same shoot.
  - Hero must not include intermediate process tools unless they are intentionally styled in the background.

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
  - Hero: `hero.jpg`
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
  - Image `src` values must point into the recipe bundle, for example `data/recipe-bundles/{recipe-id}/hero.jpg`.

- Prompt structure for each generated image:
  - `Use case: photorealistic-natural`
  - `Asset type: MyFoodCraving recipe {hero|step} image, 16:9 landscape`
  - `Recipe: {recipe.name}`
  - `Image: {hero|step number and title}`
  - `Continuity bible: {fixed environment, lighting, surface, recurring cookware, recurring props}`
  - `Subject: {exact visible food state}`
  - `Required visible items: {ingredients and utensils required for this asset}`
  - `Forbidden visible items: {future ingredients, future tools, unrelated props, finished dish if not final}`
  - `Composition: {camera angle, crop, safe margins, focal subject}`
  - `Texture/doneness: {raw/cooked/reduced/charred/silky/etc.}`
  - `Negative constraints: {full negative prompt}`

- Quality check before accepting images:
  - Every image matches the corresponding recipe step.
  - The same recurring utensils look consistent across the full set.
  - No step shows ingredients or finishing elements too early.
  - No step accidentally looks like the hero unless it is the final serving step.
  - The hero accurately represents the finished recipe.
  - The set looks like one coherent shoot.
  - The UI caption area does not cover critical food detail.
  - The image remains clear when cropped into a 16:9 card.
  - Reject and regenerate any image that violates continuity, accuracy, or ingredient timing.

- Final deliverable:
  - Save `recipe.json`, `hero.jpg`, and all step images in the recipe bundle folder.
  - Update the recipe JSON with the final `src`, `alt`, and `caption` values.
  - Keep the generic recipe template able to load `data/recipe-bundles/{recipe-id}/recipe.json`.
  - Verify in the browser that hero and every step image load correctly.
