# Visual Diagrams & Picture Generation (`visual` / `picture` / `diagram`)

Load this file in your initial batched read whenever `visual` is active (`auto` default) and `M0`/`M1+`/`trace` qualifies under Section 1, or when the user asks for `visual`, `picture`, or `diagram`.

You have **full creative permission** to generate **any kind of picture** that makes the project or module easiest to understand at a glance — never trap explanations inside repetitive dark-gradient box-and-arrow flowcharts. Keep every visible label in **easy, everyday English** and grounded strictly in verified code.

## Contents
- 1. When & How Many Pictures (As Many as Needed, Split by Concept)
- 2. Visual Freedom: Match Picture Type, Aspect Ratio & Style to the Concept
- 3. Fast Parallel Speed Protocol & Antigravity Model Reality
- 4. Prompt Craft & Readability Guardrails
- 5. Verification, Embedding & Fallback Contract

---

## 1. When & How Many Pictures (As Many as Needed, Split by Concept)

Do **not** cram 10+ unrelated ideas onto one cluttered canvas, and do **not** restrict rich modules to 1 picture. Generate **as many focused pictures as needed** (`1` picture per distinct concept, mechanism, math behavior, data change, boundary, or failure mode):

- **On `M0` (`visual auto`):** When `M0` spans `≥ 3` layers or trust boundaries, generate **2+ parallel pictures as needed** (for example: an *Illustrated Architecture Cutaway* + a *Worked User-Request Storyboard* or *Boundary Lock Map*).
- **On `M1+` / `trace` (`visual auto`):** When a module has `≥ 2` distinct mechanics, formulas, data transformations, state changes, or fallback paths, generate **as many parallel pictures as needed** (typically `2–4`, each using the visual format that fits its concept best). Simple single-step linear helpers stay ASCII-only unless `visual` is requested.
- **On demand (`visual [topic/style]`, `picture [topic]`, `diagram [topic]`):** Generate **1 to N parallel pictures** in whatever format or style the user asked for (e.g., `visual whiteboard`, `visual plot`, `visual comic`, `visual blueprint`) or the clearest mix for the topic.
- **Never auto-generate** during `quiz` or `defense` turns.
- **Additive only:** Never replace the required text sections (`Big Picture`, `ASCII Flow`, `How it works`, `Worked Example`) with images alone — pictures complement the card.

---

## 2. Visual Freedom: Match Picture Type, Aspect Ratio & Style to the Concept

**Anti-Clone Rule:** Never repeat one visual template across pictures, and never default to generic dark-slate neon/gradient rounded-box flowcharts. Every picture's **format**, **art style**, **palette**, and **aspect ratio** should fit what it is explaining.

### Choose (or Invent Beyond) the Best Picture Type for the Idea
- **Math Curve, Plot or Sensitivity Chart:** For formulas, decay rates, thresholds, or weight distributions — draw a clean plotted curve, bar breakdown, slider gauge, or dual-line comparison with annotated inflection points (never force a math curve into flowchart boxes).
- **Before vs. After Split / Comparison Table:** For deduplication, normalization, filtering, or design tradeoffs — draw a crisp left-vs-right transformation showing real sample inputs turning into final outputs.
- **Architectural Blueprint, Cutaway or Trust Map:** For `M0` boundaries, client-vs-server splits, proxies, or APIs — draw an architectural blueprint, cutaway building/zone map, or physical lock/checkpoint boundary showing what crosses the wall and what stays locked behind it.
- **Memory, Cache or Data Structure Snapshot:** For LRU caches, eviction priority, queues, hash buckets, or embedding spaces — draw a physical stacked shelf, bucket rack, priority ladder, or 2D cluster scatter map showing what survives vs. what gets dropped first.
- **Worked-Number Receipt / Calculation Card:** For concrete step-by-step scoring examples — draw a clean annotated breakdown card or visual worksheet showing real numbers flowing through each arithmetic operation.
- **Annotated UI Wireframe / Product Mockup:** For UI state, badges, modals, or client-side features — draw a clean screen wireframe with numbered pins explaining what backend or math rule drives each visible element.
- **Comic Strip / Illustrated Storyboard / Concrete Visual Scene:** For end-to-end request stories, race conditions, or everyday mental models — draw a 3–4 panel storyboard or clean illustrated scene with speech/caption callouts grounded in the real code's numbers and rules.
- **Decision Tree, Funnel, State Lifecycle or Sequence Timeline:** For branching rules, candidate narrowing, async retries, or multi-actor handoffs — draw a narrowing funnel, branching tree, circular state wheel, or vertical sequence track.
- **Flow Diagram (Only When Sequential Routing Fits Best):** Even when a flow really is the clearest choice, vary the form (vertical waterfall, circular retry loop, swimlane track) instead of repeating generic box-and-arrow templates.

### Vary Visual Medium, Palette & Aspect Ratio
When dispatching multiple pictures in one turn, **deliberately vary their look and composition** so they feel tailored, not cloned:
- **Styles & Palettes to Rotate (or invent your own):**
  - *Light Editorial Paper:* warm off-white or cream paper, crisp charcoal ink, 1–2 muted accents (terracotta + navy, or sage + slate).
  - *Drafting Blueprint / Grid Schematic:* classic cobalt or soft-gray engineering grid, fine callout leaders, clean dimension ticks.
  - *Whiteboard / Notebook Marker Sketch:* clean hand-drawn markers on white or dotted notebook paper, circled numbers, underlined takeaways.
  - *Data-Journalism Chart:* crisp white plot canvas, subtle gridlines, distinct solid curves/bars, direct point labels (zero glowing cards).
  - *Flat Vector / Risograph / Ink-and-Wash Scene:* tactile illustrated panels, characters/objects, clean editorial contrast.
  - *Clean UI Frame / Telemetry Console:* light or dark app screen mockup only when showing literal UI screens, logs, or dashboards.
- **Aspect Ratio (`AspectRatio`):** Match shape to layout — `16:9` for wide timelines, before/after splits, or panoramic scenes; `4:3` or `3:2` for plots, blueprints, or storyboards; `1:1` for cluster maps, matrices, or single scenes; `3:4` or `4:5` for stacked eviction ladders, tall funnels, or mobile UI frames.

---

## 3. Fast Parallel Speed Protocol & Antigravity Model Reality

### Antigravity Runtime Reality
- **Subagent planner vs. image backend:** Calling `invoke_subagent` with `TypeName: "image-generator"` and `Model: "flash_lite"` selects the fastest LLM planner to invoke `generate_image`, **not** the underlying diffusion model. In Antigravity, `generate_image` exposes only `AspectRatio`, `ImageName`, and `Prompt` (no `model` parameter); the Antigravity runtime automatically picks its built-in Nano Banana backend (`~15–20s` per image).
- **Nano Banana Lite (`gemini-3.1-flash-lite-image`):** Select it ONLY if a real tool/API `model` parameter is exposed; never write model IDs inside `Prompt` (they can leak into rendered text).
- **Paid API guard:** Never run custom scripts that spend external paid image API keys (e.g., `GEMINI_API_KEY`) without showing the exact command first and marking `[Needs approval]`.

### 4-Step Parallel Speed Protocol (Essential on Reasoning Models)
Every extra sequential tool round-trip adds model thinking latency. Keep image turns fast:
1. **Batch initial reads (Turn 1):** Read this visual guide, run `rg`, and read the module's primary code blocks together in **one parallel tool batch** (`≤ 2` batched read turns before launching visuals).
2. **Dispatch ALL `1..N` `image-generator` calls in parallel (Turn 2):** Launch every picture needed for the module **in the same single turn** (`Model: "flash_lite"`), alongside any remaining secondary `read_file` checks. Launching `3–4` pictures in parallel takes roughly the same wall-clock time as `1`.
3. **Zero polling (`No manage_subagents loops`):** Never loop-poll `manage_subagents` while images render — each poll wastes an entire reasoning turn. Wait for subagent completion messages (or run final non-image test/code reads in parallel while waiting).
4. **Single parallel `read_file` inspection:** Inspect all returned `.jpg`/`.png` paths in **one parallel `read_file` batch** before writing the response.

### Speed Overrides & Mermaid Fallback
- **`visual mermaid`:** Skip raster subagents (`0s` image wait) and emit crisp **Mermaid** diagrams alongside `ASCII Flow` — choosing the diagram family that fits (`sequenceDiagram`, `stateDiagram-v2`, `xychart-beta`, `erDiagram`, `quadrantChart`, `flowchart`).
- **`visual off`:** Skip extra diagrams and keep ASCII Flow only for fastest reading.
- **Fallback path (harnesses without `image-generator`, or after generation failure):** Output the best-fit **Mermaid** diagram (`sequenceDiagram`, `stateDiagram-v2`, `xychart-beta`, `flowchart`, etc.) alongside `ASCII Flow`, and state plainly that raster image generation was unavailable or failed.

---

## 4. Prompt Craft & Readability Guardrails

Keep each `image-generator` prompt **concise (`6–12` lines)** so `flash_lite` invokes `generate_image` cleanly without wasting reasoning time:

- **One Clear Visual Story:** Give each picture **1 central idea or scene** so labels remain big, spacious, and scannable (split unrelated concepts across parallel pictures).
- **Legible Text Without Clutter:** Keep titles short (`2–6` words), callouts crisp (`≤ 8` words), and avoid walls of tiny text that render garbled — let the visual geometry (curves, height, thickness, spatial zones, panels, colors) carry meaning rather than stuffing paragraphs into boxes.
- **Strict Code Grounding:** Include ONLY verified behaviors, thresholds, counts, formulas, and failure paths directly observed in code (e.g., `"Day 347 = 0.50 weight"` or `"Drops AI Caches First, Vault Untouched"`).
- **Plain Everyday English:** Use human action words (`"Checks Date"`, `"Keeps Newest Rating"`, `"Blocks Raw Keys"`) instead of dumping raw syntax unless annotating a clean sample snippet intentionally.

---

## 5. Verification, Embedding & Fallback Contract

1. **Inspect every generated file in parallel:** Call `read_file` on every saved `.jpg` or `.png` path returned by `image-generator` before showing it.
2. **Check spelling, legibility, and truth:** Verify every visible word, number, curve, and arrow against real code. Also confirm the set of pictures actually looks varied and clear (not repetitive garbled flowcharts). If any text is garbled or misstates logic, regenerate **once** with simpler phrasing and fewer words; if still flawed, fall back to a **Mermaid** diagram instead of displaying a broken picture.
3. **Keep project repo clean:** Explicitly pass the **parent conversation's artifact directory path** in every `image-generator` prompt (never save generated pictures inside the user's repository unless requested).
4. **Embed clearly in response:** Present each verified picture with a clickable `file:///` link and inline image markdown (`![Caption](file:///.../image.jpg)`, using forward slashes on Windows), then finish with `Code anchor:`, `Menu:`, or `[Current State: ...]`.
