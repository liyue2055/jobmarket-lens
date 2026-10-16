# Music licence record: JobMarket Lens V2.5 tour (music version)

| Field | Value |
|---|---|
| Asset | Background music bed in `node25/public/video/tour-v2-720.mp4` (the 1:51 tour) |
| Provider / product | ElevenLabs, Eleven Music (API `POST /v1/music`) |
| Generated | 2026-10-16, by the ku2055 account owner's API key |
| Account plan at generation | ElevenLabs **Starter** ($6/month), which lists "Commercial License for Speech and Music" (account plan page, screenshot kept by the owner) |
| Song ID | `aUibUdwDfwSGasQtzFM6` (response header `song-id`); trace `e15e09d346ccb1f341b937c4a3e6ab33` |
| Request | `music_length_ms` 120000, `force_instrumental` true, output `mp3_44100_192` |
| Prompt | "Calm, modern instrumental underscore for a software product tour: light piano, soft warm synth pads, gentle plucked arpeggio, subtle steady pulse around 96 bpm, optimistic and clear, unobtrusive under spoken narration, no vocals, no drums fills, smooth fade-in and clean ending." |
| Checks | 120.0 s, −18.0 LUFS integrated; no vocals (automated audio check, Qwen Omni) |
| Use in the video | Trimmed to the video length, 2 s fade-in and 4 s fade-out, ducked under the narration (sidechain), final mix −15.7 LUFS |
| Attribution | Not required by the plan as listed. Suggested credit: "Music generated with Eleven Music by ElevenLabs." |
| Terms | ElevenLabs Terms of Service and Eleven Music terms at elevenlabs.io (check the current versions; reviewers' own reading of the plan terms governs) |

Other generated elements in the same video:

- Narration: Google Gemini 3.8 Flash TTS (voice Kore) via OpenRouter.
- Guide portrait: GPT Image 2.5 via Duomi.
- Screen content: the public JobMarket Lens canvas, captured by the project.

Not used anywhere in public assets: the Suno beds generated via Duomi. They are licensed for drafts and internal use only, and stay in `*_INTERNAL_REVIEW_DO_NOT_PUBLISH` files.

Before cancelling or downgrading the plan, check in the current ElevenLabs terms whether music generated while on a commercial-licence plan stays licensed afterwards. This record does not assume it.
