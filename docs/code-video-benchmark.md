# A video file made in code, with no key (2026-10-26)

The operator: *"Ensure videos are also created if no hugging face key is also
provided. Figure out how to generate the videos using code, do proper
competitive benchmarking and research on it, and then implement."*

Before this, a brand with no video key (Pollo, Higgsfield, Veo, a Hugging Face
Space) got the Story video as a canvas the BROWSER recorded with
MediaRecorder: real-time, so a 19 s video took 19 s of an open tab, and a
photo host without CORS made it unsaveable. No file was made on the server.

## What the field does

| Approach | How a frame is made | How it is encoded | Fits Vercel Hobby (12 functions, 120 s, 4.5 MB answer)? |
|---|---|---|---|
| Remotion (remotion.dev) | React component rendered per frame in headless Chromium | ffmpeg | Not as is: its Lambda renderer is AWS; it needs a company licence above a small team size |
| HyperFrames-style HTML-to-video | HTML/CSS seeked to frame t in a headless browser | ffmpeg | Needs an ffmpeg binary in the function (size), same model otherwise |
| editly (mifi) | Node + canvas/GL per frame | ffmpeg | ffmpeg + native canvas: too heavy for the function bundle |
| Creatomate / Shotstack (template APIs) | Their renderer | Theirs | A paid key: what this task is about avoiding |
| Hugging Face Spaces (ZeroGPU) | A model | Theirs | A key and a GPU quota per account; queues |
| **Here: deterministic frame(t) + WebCodecs + Mediabunny** | The Story video's own canvas, drawn at exact times in headless Chromium | The browser's own WebCodecs encoder (H.264 or VP9), muxed by Mediabunny (MPL-2.0, ~700 KB) | **Yes**: Chromium is already in the bundle (`@sparticuz/chromium` for the rendered brand read) |

The common shape of every code renderer worth copying: a frame is a pure
function of time (no real-time playback, no dropped frames), so a 19 s video is
as many frames as it needs, drawn as fast as the machine can.

## What was built

- `scripts/lib/story-ad.js`: the Story player exposes `window.__story`
  (`frame(t)`, `size(w,h)`, `cut()`, `ready()`), and with
  `window.__STORY_RENDER` it does not play itself. `storyDataFrom(html)`
  reads the scenes back and VALIDATES them (kinds, lengths, http(s) images,
  known moves, a total of 30 s at most, hex palette, cleaned font names);
  the page rendered is rebuilt by `storyPage()` from that data, never the
  markup a request sent.
- `api/_shared/code-video.js` on `public-config.js?action=video-render`
  (still 12/12): POST, this site's own pages or a signed-in account, the
  rendered-read limiter (`video`: 12 per address, 60 per instance per 10 min).
  The page is served at `https://render.invalid/` (WebCodecs needs a secure
  context); the ONLY other requests answered are Mediabunny and the story's own
  photos, each fetched by the server behind `assertPublicUrl` on every
  redirect hop, images only, 8 MB each. Everything else is aborted.
- Codec: H.264 in MP4 when the browser can encode it (`@sparticuz/chromium`
  in production can), else VP9 in WebM (the Playwright Chromium here). No AAC
  encoder exists in either, so the file is silent and says so.
- Size and time: the bitrate is chosen so the file fits 4 MB (under Vercel's
  4.5 MB answer); 24 fps; a ladder 1080p → 720p → 540p that projects the total
  after one second of frames and moves down, or answers `too_slow` with a
  sentence, never a cut-off request.
- `/brain`: each Story video has "MP4 video (made in code, no key)"; a keyless
  `video-generate` answer carries `story_html` and the route to render it.

## Measured (this container and production's Chromium)

- `@sparticuz/chromium` 153: H.264 encodes; 720p at 30 fps ≈ 75 ms a frame;
  a 19 s story at 720p/24 fps rendered in ≈ 36 s, at 540p ≈ 24 s; ≈ 3.1 MB.
- Playwright Chromium 141: no H.264 encoder; VP9 WebM, 2.35 MB for 19 s.

## Not done, said

- No sound in the file (no AAC encoder in either Chromium; an Opus track in
  WebM would play in browsers but not in every ad manager).
- The Story video's in-browser "Save as video" (with the composed music
  recorded in) stays: that is where a soundtrack is added today.
