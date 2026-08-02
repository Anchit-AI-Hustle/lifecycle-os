# Imported agent workflows (Content Intelligence)

The Content Intelligence system (Daily Blog Agent, KNICKGASM Creator Plan) treats
two existing ChatGPT conversations as **imported specifications**. Claude Code
cannot read ChatGPT conversations directly, so export each one here:

```
knowledge/agents/daily-blog-agent/conversation.md   + requirements.md
knowledge/agents/knickgasm-creator-plan/conversation.md + requirements.md
```

Rules (see docs/content-intelligence-gap-analysis.md):
- These are workflow specs, NOT sources of product facts. Every live product fact,
  price, review, claim, URL, image, font, and colour must still come from the
  approved repository data + the exact official regional KNICKGASM product page.
- Until both exports are present, `api/_shared/content-core.js` reports
  `importStatus: "not_found"` and the system runs the generic framework only,
  never claiming the historical requirements were imported.
