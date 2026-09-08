# Knowledge base

Everything in this folder is what the co-presenter is allowed to use as fact. The model is
instructed to say "I don't have that detail here" rather than invent anything outside it.

## How to add content

Drop `.md` files in this folder. Structure them with `##` headings — each heading becomes a
retrievable chunk, so a good heading is one a customer question would match:

```markdown
# Product pricing

## What does the Standard tier include
...

## How licensing works for external users
...
```

Guidelines that make retrieval work well:

- One idea per `##` section; keep sections under roughly 1200 characters.
- Write headings as the question a customer would ask, not as internal jargon.
- Include the specifics you would otherwise have to look up mid-call: numbers, limits,
  SKU names, supported regions, competitor comparisons, standard objection responses.
- Add a `## Common objections` section per topic — it is the highest-value content here.

The index is built at server startup. Restart the server after editing files.
