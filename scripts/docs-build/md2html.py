#!/usr/bin/env python3
"""PRD markdown -> brand-styled, print-ready HTML (for Chromium print-to-PDF)."""
import re, sys, html

SRC, OUT = sys.argv[1], sys.argv[2]
lines = open(SRC, encoding="utf-8").read().split("\n")

def inline(t):
    t = html.escape(t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\*(.+?)\*', r'<em>\1</em>', t)
    t = re.sub(r'`(.+?)`', r'<code>\1</code>', t)
    t = re.sub(r'\[(.+?)\]\((.+?)\)', r'<a href="\2">\1</a>', t)
    return t

out = []
i, n = 0, len(lines)
while i < n:
    line = lines[i]
    if line.strip().startswith("|") and i+1 < n and re.match(r'^\s*\|[\s:\-|]+\|\s*$', lines[i+1]):
        header = [c.strip() for c in line.strip().strip("|").split("|")]
        i += 2; rows = []
        while i < n and lines[i].strip().startswith("|"):
            rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
        out.append("<table><thead><tr>" + "".join(f"<th>{inline(h)}</th>" for h in header) + "</tr></thead><tbody>")
        for r in rows:
            out.append("<tr>" + "".join(f"<td>{inline(r[j] if j<len(r) else '')}</td>" for j in range(len(header))) + "</tr>")
        out.append("</tbody></table>"); continue
    m = re.match(r'^(#{1,6})\s+(.*)$', line)
    if m:
        lvl = len(m.group(1)); out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>"); i += 1; continue
    if line.strip() == "---":
        out.append("<hr>"); i += 1; continue
    if line.strip().startswith(">"):
        out.append(f"<blockquote>{inline(line.strip()[1:].strip())}</blockquote>"); i += 1; continue
    ml = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', line)
    if ml:
        ordered = bool(re.match(r'\d+\.', ml.group(2))); tag = "ol" if ordered else "ul"
        items = []
        while i < n:
            mm = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lines[i])
            if not mm: break
            items.append(f"<li>{inline(mm.group(3))}</li>"); i += 1
        out.append(f"<{tag}>" + "".join(items) + f"</{tag}>"); continue
    if not line.strip():
        i += 1; continue
    out.append(f"<p>{inline(line)}</p>"); i += 1

body = "\n".join(out)
doc = """<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#111111; font-size:10.5pt; line-height:1.55; }
h1 { font-family: Georgia, 'Times New Roman', serif; color:#D0473E; font-size:24pt; margin:0 0 6pt; }
h2 { font-family: Georgia, serif; color:#D0473E; font-size:15pt; margin:20pt 0 6pt; border-bottom:2px solid #6A33D8; padding-bottom:3pt; }
h3 { color:#6A33D8; font-size:12pt; margin:14pt 0 4pt; }
h4 { color:#D0473E; font-size:11pt; margin:10pt 0 3pt; }
p { margin:5pt 0; }
a { color:#6A33D8; }
code { font-family:'Consolas',monospace; color:#D0473E; background:#FFFFFF; padding:0 3px; border-radius:3px; font-size:9.5pt; }
strong { color:#111111; }
hr { border:0; border-top:1px solid #6A33D8; margin:10pt 0; }
blockquote { margin:8pt 0; padding:6pt 12pt; border-left:3px solid #6A33D8; color:#D0473E; font-style:italic; background:#FFFFFF; }
ul, ol { margin:5pt 0 5pt 6pt; padding-left:14pt; }
li { margin:2pt 0; }
table { border-collapse:collapse; width:100%; margin:8pt 0; font-size:9pt; page-break-inside:avoid; }
th { background:#D0473E; color:#FFFFFF; text-align:left; padding:5pt 7pt; font-size:8.5pt; }
td { border:1px solid #e4dcc9; padding:5pt 7pt; vertical-align:top; }
tr:nth-child(even) td { background:#FBF9F1; }
</style></head><body>
""" + body + "</body></html>"
open(OUT, "w", encoding="utf-8").write(doc)
print("wrote", OUT)
