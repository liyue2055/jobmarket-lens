# JobMarket Lens V2.5 tour video

A separate video-team contribution, following the "Future video contribution boundary" in the
[brand guide](V2_5_BRAND_GUIDE.md). It adds a self-hosted 1:51 guided tour of the research canvas,
opened from a **Watch the tour** button next to **Share study**.

![Tour dialog on the canvas](v25-video-tour.png)

## What is in this change

| Path | Purpose |
|---|---|
| `node25/src/video/TourPlayer.tsx` | `TourButton`: hero button plus a native `<dialog>` player, chapter list and transcript |
| `node25/src/video/tourContent.ts` | Chapter start times, transcript (written forms), file paths, size and the release the tour was recorded on |
| `node25/src/video/video.css` | Isolated styles built on the V2.5 tokens (ink, teal, line, muted; 12/18 px radii) |
| `node25/public/video/tour-v2-720.mp4` | H.264 1280×720, AAC 96 kbit/s, 111 s, 4.7 MB: narration, interface clicks and a licensed music bed |
| `node25/public/video/tour-v1-720.mp4` | Previous narration-only file, kept so pages cached before this change still play; safe to remove later |
| `node25/public/video/music_license.md` | Music licence record: provider, plan, song ID, prompt, checks and mix |
| `node25/public/video/tour-v1-poster.jpg` | 1920×1080 poster (title frame, no caption bar) |
| `node25/public/video/tour-v1.en.vtt`, `tour-v1.chapters.vtt` | Caption and chapter tracks |
| `node25/test/browser/video.spec.ts` | Browser checks listed under Verification |
| `node25/src/Studio.tsx` | Two lines: the import and `<TourButton />` in the hero actions |
| `node25/vercel.json` | One header rule: `/video/*` cached for a year as immutable (file names carry a version) |

No other component, data path, API route or analytics call changes.

## Bandwidth

- Nothing video-related is requested on page load; the button is plain markup.
- Opening the dialog renders the `<video>` with `preload="none"`: the poster (about 77 kB) and the small
  caption files may load, the 4.7 MB MP4 does not. A browser test asserts no MP4 request before play.
- After play the file streams with HTTP range requests from the same origin. With the `/video/*` cache
  rule, a returning viewer does not download it again.

## Privacy

- Same-origin files only: no third-party player, embed script, cookie or tracking pixel.
- No autoplay. The existing site analytics are not extended with video events.
- The music is part of the video file; no music service is contacted at playback.
- The file contains a screen recording of the public canvas only (no admin views, no private evidence).

## Accessibility

- Opening control is a real button with `aria-haspopup="dialog"`; the dialog is a native modal
  (`showModal`), so focus moves into it, Esc closes it and focus returns to the button.
- The dialog is labelled by its title and described by a text note; the close button has a label.
- Captions are burned into the picture. The same text ships as a WebVTT caption track (available in the
  player, off by default to avoid duplicate text) and as a full transcript in a disclosure.
- Chapter buttons seek the player; native video controls are keyboard operable.
- `prefers-reduced-motion` is respected by never autoplaying; the viewer starts playback.
- Automated axe WCAG 2 A/AA and 2.1 AA checks on the open dialog report no violations. This is not a
  full accessibility audit or a test with assistive-technology users.

## Content and disclosure

- The guide portrait and narration voice are AI-generated (image: GPT Image 2.5 via Duomi; voice: Gemini
  3.8 Flash TTS via OpenRouter); the dialog says so. The tour shows the real canvas, captured with
  Playwright on 2026-10-16 from `lens.feedos.si`, release `2d18d6d0`.
- Every number in the narration was read from that release on screen (82,851 open postings; 222 in the
  Amazon × computer-and-math cell; 7,963 vs 15,604 in views A and B; Python 3,621 vs 103; 19,242
  co-mentions). Wording follows the canvas's own limits: observed postings, not real-time vacancies,
  hires or available talent; a skill mention is a clue, not a requirement.
- Music: an instrumental bed generated with ElevenLabs Eleven Music on a plan that includes a commercial
  licence for music, ducked under the narration. The record is in `node25/public/video/music_license.md`
  (song ID, prompt, plan, date, checks). A narration-only version can replace it by swapping the MP4.

## Keeping it current

The dialog states the release and date the tour was recorded on. When the canvas layout or the release
changes enough that the screens or numbers differ, re-record and publish new versioned files
(`tour-v2-…`) rather than replacing these, then update `tourContent.ts`. The recording pipeline
(capture script, timeline, renderer) is kept with the video team.

## Verification (2026-10-16, local)

- `npm test`: 30 passed. `npm run build`: passed; `dist/video/` contains the four files.
- `npx playwright test`: 11 passed, including the 9 existing studio scenarios and 2 new video checks:
  no MP4 request before play; `preload="none"`, no autoplay, caption track present and off by default;
  axe checks on the dialog; transcript text and six chapter buttons; Esc closes and focus returns; video
  and caption files served same-origin with `video/mp4` and range support.
- An existing mobile check (no horizontal overflow at 390 px) first failed with the extra hero button;
  the action row now wraps on screens under 768 px and the check passes.
- Not verified here: deployed Vercel behavior of the cache header and range requests, real mobile
  networks, and assistive-technology use.

## Production verification after merge

PR #5 was merged into `main` as `0774651134010cd3c3a1e825609c7f04c8747749` and deployed to
https://lens.feedos.si. The [live verification receipt](V2_5_VIDEO_DEPLOYMENT_CHECKS.json) records
actual HTTP 206 range delivery (1,024 bytes), `video/mp4`, versioned immutable cache headers, and
successful headless Chromium playback of the 1280×720, 111.418-second file with no page errors.
The two video browser scenarios also passed against the production domain, covering lazy loading,
caption/transcript availability, dialog accessibility and Escape/focus behavior. Physical mobile
networks and assistive-technology user testing remain unverified.
