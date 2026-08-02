# Docs build (PRD + deck → Word / PDF / PPT)

Reliable in this environment (no pandoc/LibreOffice-convert): python-docx + python-pptx
build the editable Office files; Chromium prints the PDFs from generated HTML.

```bash
pip install python-docx python-pptx
CH=/opt/pw-browsers/chromium

# PRD → Word + PDF (source of truth: docs/PRD.md)
python3 scripts/docs-build/md2docx.py docs/PRD.md docs/PRD.docx
python3 scripts/docs-build/md2html.py docs/PRD.md /tmp/PRD.html
"$CH" --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf=docs/PRD.pdf "file:///tmp/PRD.html"

# Deck → PPT + PDF (slide data lives in build_deck.py)
python3 scripts/docs-build/build_deck.py            # writes docs/deck.pptx + /tmp deck_print.html path printed
"$CH" --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf=docs/deck.pdf "file://$PWD/scratchpad/deck_print.html"
```
Brand rules (palette, Georgia/Montserrat + Helvetica/Proxima) are baked into both renderers.
