# MyFoodCraving Video Design System (Veo 3.1 Optimized)

## 1) Purpose
This document translates the **existing MyFoodCraving website design system** into a repeatable, prompt-ready framework for generating 20–30 second nutrition tip videos (food hacks) with consistent visual identity and strong Gen Z / Millennial appeal.

Use this as the single source of truth for:
- Visual style and color behavior.
- Typography personality and on-screen text treatment.
- Motion language and pacing.
- Shot composition for short-form vertical video.
- Hook and retention patterns tuned for social feeds.

---

## 2) Brand Essence to Preserve

### Core vibe
- **Editorial food magazine + playful handcrafted layer**.
- Feels premium but approachable.
- “Nutrition science made warm, human, and craveable.”

### Emotional targets
- Curiosity in first 1–2 seconds.
- Trust (grounded, useful, not fear-mongering).
- Delight (small hand-drawn style details, tactile food closeups).
- Action (save/share/try tonight).

### Tone rules
- Speak with confidence but avoid absolutist medical claims.
- Use practical, tiny “wins” the viewer can apply immediately.
- Keep copy punchy and rhythmic; avoid long academic phrasing.

---

## 3) Canonical Design Tokens (from site)

### Color palette
Use these as dominant anchors in props, backgrounds, grading accents, text plates, and overlays.

- Cream: `#F7F1E3`
- Cream deep: `#EFE6CF`
- Cream soft: `#FBF7EC`
- Paper: `#FFFCF3`
- Kraft: `#E8DCC0`
- Ink: `#1F1A14`
- Ink soft: `#3A332A`
- Ink muted: `#6B6253`
- Ink faint: `#9A8F7C`
- Orange (primary accent): `#FF6D2E`
- Orange deep: `#E2531A`
- Matcha: `#7A9C5A`
- Matcha deep: `#5E7E40`
- Berry accent: `#C84B5A`
- Butter accent: `#F4D67A`

### Color usage ratios (video)
- 60–70% warm neutrals (cream/paper/kraft).
- 20–30% food natural color (ingredient-driven).
- 8–12% orange or matcha accents for focal emphasis.
- <5% berry for occasional “alert/important” moments.

### Contrast
- Body text equivalent must read against cream/paper backgrounds with high contrast (ink/ink-soft).
- Never use washed-out captions on busy food footage.

---

## 4) Typography Personality (visual translation for video)
Website font families map to video styling:

- **Sans (Geist):** primary informational text.
- **Serif italic (Instrument Serif):** emphasis words (“Vitamin D”, “sunlight”, “before cooking”).
- **Handwritten accent (Caveat):** quick annotation arrows / micro-notes.
- **Mono (JetBrains Mono):** metadata labels (e.g., “NUTRITION HACK”, “15 MIN”, “SCIENCE-BACKED”).

### On-screen text hierarchy for 9:16
- H1 Hook: 72–110 px equivalent, bold sans, tight tracking.
- H2 Key claim: 54–72 px equivalent, mix sans + selective serif italics.
- Body annotation: 36–48 px equivalent.
- Micro labels: 24–30 px equivalent mono uppercase.

### Text behavior
- Max 6–9 words per card.
- One idea per card.
- Animate per phrase chunk (not per letter unless used as rare emphasis).

---

## 5) Signature UI/Graphic Language to Mirror

Translate these site motifs into video overlays:
- Rounded “pill” chips for tags.
- Sticker-like callouts with dark outline and subtle drop-shadow.
- Dot indicators using orange/matcha.
- Slight “handwritten note” moments (scribble arrows, underlines).
- Soft paper grain texture overlay across scenes.

### Shape grammar
- Corners: soft roundness (`6px`, `12px`, `20px`, `32px` equivalents).
- Buttons/chips: full pill radius.
- Borders: dark ink outlines; avoid ultra-thin cold gray lines.

### Shadow grammar
- Slightly offset, tactile, poster-like shadows.
- Avoid modern glassmorphism-heavy aesthetics except subtle blur for occasional floating tags.

---

## 6) Cinematic & Art Direction for Veo 3.1

### Framing defaults
- Aspect ratio: **9:16** vertical.
- Focal style: macro-close food details + medium action shots.
- Lens feel: realistic smartphone + premium food ad hybrid.
- Depth: shallow-to-medium DOF for ingredient emphasis.

### Lighting
- Warm natural daylight bias.
- Kitchen realism, not sterile studio white.
- Preserve texture: mushroom gills, herbs, steam, oil shimmer.

### Texture cues
- Paper-like warmth, handcrafted editorial polish.
- Tiny grain acceptable; avoid over-smooth CGI feel.

### Motion behavior
- Quick confidence in first 2 seconds.
- Micro whip, push-in, or snap zoom for hook beat.
- Smooth glides for educational midsection.
- Intentional punch at payoff (“Do this before cooking”).

---

## 7) 20–30s Narrative Blueprint (high-retention)

### Timing template
1. **0:00–0:02 Hook**
   - Contrarian or surprising line.
   - Big text, strong food visual.
2. **0:02–0:07 Problem/Reframe**
   - What most people do vs better approach.
3. **0:07–0:16 Demonstration**
   - 2–3 clear visual steps.
4. **0:16–0:24 Why it works**
   - Very short mechanism explanation in plain language.
5. **0:24–0:30 Payoff + CTA**
   - Practical result + “save this tip”.

### Hook formulas
- “You’re cooking this wrong if you want more ___.”
- “One 10-minute step can boost ___.”
- “Do this BEFORE you cook for better ___.”

---

## 8) Example Content Pattern (Mushroom + Sunlight)

### Core claim framing
“Place mushrooms in sunlight before cooking to increase vitamin D levels.”

### Shot list (example)
- Shot 1: Mushrooms on board; bold hook text.
- Shot 2: Tray moved into sunny window; timer icon appears.
- Shot 3: Closeup sunlight on gills; annotation “UV exposure”.
- Shot 4: Pan sizzle cooking sequence.
- Shot 5: Plate reveal + recap text.

### Overlay copy example
- Hook: “Want more Vitamin D from mushrooms?”
- Step: “Sun them gill-side up for ~15 min.”
- Why: “UV light helps convert compounds to Vitamin D2.”
- CTA: “Save this for your next mushroom recipe.”

---

## 9) Veo 3.1 Prompting Template (copy/paste)

Use this prompt skeleton for consistency:

```text
Create a 9:16, 24fps, 20–30 second short-form food nutrition tip video in the MyFoodCraving aesthetic:
- warm editorial food style, cream/paper color world, handcrafted premium vibe
- palette accents: orange #FF6D2E, matcha #7A9C5A, ink #1F1A14
- tactile sticker-like overlays, rounded pill labels, subtle paper-grain texture
- typography style mix: clean sans for main text, elegant serif italics for emphasis, occasional handwritten annotation arrows
- energetic first 2 seconds, then clear step-by-step pacing, with satisfying final payoff shot
- realistic kitchen daylight, macro food textures, gentle camera glide + occasional punch-in transitions
- on-screen text must be concise, high contrast, mobile readable, and limited to one idea per card

Topic: [INSERT TIP]
Audience: Gen Z and millennials interested in easy nutrition wins
Structure:
1) hook (0:00–0:02)
2) reframe (0:02–0:07)
3) demonstration (0:07–0:16)
4) mechanism (0:16–0:24)
5) payoff + save CTA (0:24–0:30)

Avoid:
- sterile clinical look
- fear-based messaging
- cluttered text
- neon cyberpunk palettes
- overly long disclaimers on screen
```

---

## 10) Editing Rules for Consistency
- Keep average shot length ~1.5–3.0 seconds.
- Use jump cuts only to increase clarity/pace.
- Reserve fastest cuts for hook + payoff.
- Ensure every text card remains visible long enough to read once comfortably.
- Prefer “show then tell” (visual first, explanation second).

### Audio direction
- Music: upbeat, modern, light groove (not aggressive EDM).
- Add subtle kitchen foley for realism (sizzle, chop, tray placement).
- Optional voiceover: conversational, confident, friendly.

---

## 11) Gen Z + Millennial Relevance Heuristics
- Fast opening claim, no slow intro.
- Functional benefits (“easy”, “today”, “one extra step”).
- Visually snackable text blocks.
- Practical time framing (“10–15 min”, “before cooking”).
- End with a save/share behavior prompt.

---

## 12) Safety & Trust Guardrails
- Do not imply guaranteed medical outcomes.
- Avoid diagnosing or treating language.
- Use phrasing like: “may help”, “can increase”, “supports”.
- Keep claims practical and food-focused.

---

## 13) Quick QA Checklist Before Publishing
- Does it look like MyFoodCraving (warm cream + ink + orange system)?
- Is the first 2 seconds attention-grabbing?
- Is the tip understandable without sound?
- Is all on-screen text legible on a phone?
- Is the claim framed responsibly (not absolute medical advice)?
- Is there a clear payoff + CTA?

If any answer is no, revise before export.
