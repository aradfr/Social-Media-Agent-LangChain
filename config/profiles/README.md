# Profiles

A **profile** is everything that makes the agent write for one niche, brand,
or use case. Code reads the active profile; no brand or niche text lives in
code.

Select one with `AGENT_PROFILE=<folder name>` in `.env` (default: `default`).

| Profile | What it is |
|---|---|
| `default/` | Brand-free starter (AI / developer tools). Copy it to make your own. |
| `langchain/` | Upstream LangChain "Community Spotlight" behaviour, kept as an option. Also selected by the legacy `USE_LANGCHAIN_PROMPTS=true`. |

## Make your own

```bash
cp -r config/profiles/default config/profiles/my-niche
# edit the files below, then in .env:
AGENT_PROFILE=my-niche
```

Restart the LangGraph server after changing a profile (it is loaded once per
process).

## `profile.json`

Text fields accept either inline text or a file name next to `profile.json`
(`.md`, `.txt`, `.json`).

| Field | Used for |
|---|---|
| `id`, `name` | Identification |
| `brand.name`, `brand.products` | Brand being promoted. Omit `name` for a neutral voice. Used in prompts ("at Acme", "Acme's product(s)") |
| `audience` | Who the posts are for (documentation; prompts use business context) |
| `prompts.businessContext` | Topics you care about. Used by relevance checks, reports, posts |
| `prompts.contentValidation` | What content is worth posting about (relevance check rules) |
| `prompts.postStructure` | Shape of a post (hook / body / call to action) |
| `prompts.postRules` | Style rules (tone, emojis, hashtags, tense, …) |
| `prompts.examples` | Few-shot example posts. In a `.md` file, separate posts with a line that is exactly `---` |
| `signature.headerPrefix` | Text prepended to every published post (e.g. `Acme Spotlight:`). Omit for none |
| `signature.stripPhrases` | Phrases removed from posts before publishing |
| `exclusions.domains` / `githubOrgs` / `youtubeChannels` | Links/sources that never become posts (e.g. your own site) |
| `exclusions.tweetsRequireExternalUrls` | Only use tweets that link to external content |
| `images.promptTemplate` | JSON prompt for image generation (style, brand colours, constraints) |
| `images.styleVariations` | One image is generated per variation |
| `images.frameTemplate` | `none` or `langchain-community` (SVG frame around generated images) |
| `images.allowedLogos` | Logos the image validator may keep (your own products) |
| `curation.preset` | `generic` or `langchain`: which sources/flow `curate_data` uses |

Platform limits (max length, link length, condense rounds) live in
`config/platforms.json`; model choices live in `config/models.json`.
