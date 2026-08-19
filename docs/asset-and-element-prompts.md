# Asset prompts and element prompts

`api/_shared/master-prompt.js`

Every generated asset carries a prompt you can paste into a blank ChatGPT,
Claude or Gemini session. There are two kinds, they produce different things,
and until this was fixed nothing said which was which.

## The reported defect

An operator copied the prompt the Smart Brain console offers, pasted it into
Gemini, and got back a product photograph instead of an email.

Nothing was broken in the model. The only prompt `smart-brain.html` ever
surfaced was an ad's `creative_brief` — an **image** brief, doing exactly what it
says. `master_prompt`, which has produced the finished artefact since the
beginning, was never rendered on the page at all; only `ad-campaigns.html` used
it. And neither prompt announced its kind, so the two were indistinguishable at
the moment of copying.

## The distinction

| | Returns | Lives on | Example |
|---|---|---|---|
| **Asset prompt** | The complete, usable artefact | `master_prompt`, `master_prompt_v1`, `master_prompt_v2` | the whole email, the whole landing page, the whole ad unit |
| **Element prompt** | One part of it | `creative_brief`, `script` | a hero photograph, a video clip |

Both are legitimate. An image brief is a good prompt — it just does not produce
a mailer.

## How an asset prompt states its job

It opens by naming the deliverable and closes by pinning the container, so a
model that reads only the first and last paragraph still produces the right
artefact.

```
DELIVERABLE: ONE COMPLETE EMAIL MAILER (text and visual), ready to paste into an
ESP. Not a plan, not a section-by-section outline, not only a hero image. The
finished email.

  … brand block, market, products, contract …

OUTPUT FORMAT: ONE email HTML document, complete and paste-ready.
Table-based layout (Outlook renders with the Word engine), max 600px content
column, all CSS inline on the elements…
Every image is an <img> with a hosted URL I supplied plus real alt text. Never
base64: Gmail clips a message past roughly 102KB and the mailer would be cut
mid-layout.
```

The three things Gemini returned instead — a plan, an outline, a hero image —
are ruled out **by name**, because that is what it actually did.

Per type:

- **mailer** — table-based email HTML, ≤600px, inline CSS, hosted image URLs,
  readable with images off, subject lines + preheader + plain text before the
  HTML.
- **landing page** — one `<!doctype html>` document that starts and ends
  correctly, all CSS in one `<style>`, renders with JavaScript disabled.
- **ad** — `COPY` / `CREATIVE` / `IMAGE BRIEF` / `WHY`, in that order, every
  platform field within its limit.

Every one of them forbids base64. That is not a style rule: it is the difference
between a mailer that arrives and one that is cut in half.

## How an element prompt states its job

`buildElementPrompt(brief, {produces, partOf})` wraps a raw brief:

```
DELIVERABLE: ONE HERO PHOTOGRAPH — ONE ELEMENT of a complete email mailer, not
the asset itself. Do not return an email, an ad unit or a page. Return only this
element.

Close-up on concrete, morning light.

Return the image only. No text baked into the image, no watermark, no logo, no
border, no collage of options. One frame.
```

It deliberately does **not** carry the brand block. This goes to an image model,
and burying a shot description under six paragraphs of typography and
banned-phrase rules is how a hero comes back with text baked into it.

An empty brief produces no prompt at all — a button that copies a bare header is
worse than an absent button.

## The index the UI renders

`promptsFor(asset, assetType)` returns every copyable prompt for one asset,
**whole-asset prompts first**. Ordering is the fix, not decoration: the operator
copies the first thing that looks like the job.

```js
[
  { id: 'master_prompt_v2', label: 'Complete mailer, text and visual',
    kind: 'asset',   produces: 'the whole email', from: 'master_prompt_v2' },
  { id: 'creative_brief',   label: 'Hero image only',
    kind: 'element', produces: 'one photograph',  text: '…' },
]
```

An **asset** row carries `from`, the field that already holds the text, rather
than a copy of it. Duplicating a ~5KB prompt onto the same object is how the two
drift, and the prebuild queue is ~180 slots wide per brand — the index is ~700
bytes where inlining is ~11KB. An **element** row carries `text`, because the
wrapped form exists nowhere else. Pass `{inline: true}` when you want everything
resolved (exports, tests).

`attachMasterPrompts()` attaches `prompts` to the mailer, every ad and every
landing page, after `master_prompt` exists — an asset row built earlier would
point at an empty field.

## In the console

`smart-brain.html` renders both kinds side by side on every asset pane. The kind
is a chip **inside the button**, not a tooltip: an operator copying in a hurry
reads the button and never the title attribute. Green returns the finished
asset, grey returns one element, and the pane says so in words underneath.

The ad card's `Creative brief` row is now labelled **Image brief (one
element)** — the old name reads like the brief for the whole ad.

## Tests

`tests/asset-vs-element-prompts.spec.js` runs the builders and then drives the
real page: it stubs the clipboard, clicks the buttons an operator clicks, and
asserts on the **text that actually lands there** — not on the presence of
markup. A prompt that exists in a payload and never reaches a button is the bug
that was reported.
