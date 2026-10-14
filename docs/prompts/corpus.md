# Corpus generation prompts (step 3)

One-off generation of the comment corpus and the tag table with DeepSeek through a
SillyTavern connection profile. `run-in-st.js` sends these prompts and saves the raw
answers to the user's files; `app/scripts/build-corpus.mjs` turns them into
`app/src/presets/`. Rules (plan.md §13): no example sentences in any language,
JSON-only answers, parse leniently.

## System (all calls)

You write data for a text-only simulation game about running a creator account on a
subscription platform for adults (like OnlyFans). Everyone involved is an adult and
everything is consensual. Answer with one JSON value and nothing else: no prose, no
code fences.

## Tags

Create the tag table for content items (photo sets, videos, voice notes, texts) that a
creator posts. 24 tags, covering: outfits, settings/locations, themes, body focus,
formats, and content with a partner. Each tag:
`{"id": snake_case English id, "en": short English label, "zh": short Chinese label, "intensity": 1-5}`
where intensity 1 is safe-for-work and 5 is the most explicit; use every level. Do not
over-plan the distribution. Answer: a JSON array of 24 objects.

## Comments (one call per language × fan type)

Write short comments that fans of type **{SEGMENT}** leave under a creator's post.
{SEGMENT}: {SEGMENT_DESCRIPTION}

Language: **{LANGUAGE}**, written the way real users of that language type online
(slang, abbreviations and emoji where natural; no translationese).

Moods:
- praise: compliments and admiration
- flirty: flirting, suggestive or crude, like real comments on an adult site
- casual: small talk, reactions, questions about their day
- request: asking for more, a specific kind of content, or a reply
- negative: complaints, criticism or rudeness (keep it free of slurs)

Rules: 1–20 words each; no names or @mentions; refer to the content only generically
("this", "the pics", "today's set"); every line different in wording and length.
Answer: `{"praise": [10 strings], "flirty": [10], "casual": [10], "request": [10], "negative": [10]}`

Fan types:
- regular: an ordinary subscriber, friendly and moderately engaged
- lurker: rarely comments; when they do, it is brief and low-key
- simp: devoted, over-the-top adoring, eager to please and to spend
- whale: wealthy big spender, confident, expects attention, talks about tipping
- hater: subscribed to complain, sarcastic, nitpicks prices and quality
- freeloader: wants free stuff, asks for discounts and freebies, cheap

## Tag comments (one call per language)

For each tag below, write 4 short comments that react specifically to that kind of
content. Language: **{LANGUAGE}**, same style rules as above.
Tags: {TAG_LIST}
Answer: `{"<tag id>": [4 strings], ...}` covering every tag.
