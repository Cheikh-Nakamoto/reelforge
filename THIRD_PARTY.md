# Third-party software and models

studio's own code is under the [PolyForm Noncommercial License 1.0.0](LICENSE). It bundles **one** piece of
third-party code, listed first; everything else is installed by npm or downloaded on first use into the user's
caches (`~/.cache/hyperframes/`, `node_modules/`). Each keeps its own licence.

| Bundled file | Origin | Licence |
|---|---|---|
| `templates/vendor/motion-blur.js` | HyperFrames registry, `registry/components/motion-blur` (HeyGen), script body unmodified | Apache-2.0, copy in `templates/vendor/LICENSE-hyperframes-apache-2.0.txt` |

| Component | Used for | Licence | Fetched by |
|---|---|---|---|
| [HyperFrames](https://github.com/heygen-com/hyperframes) 0.8.188 (pinned) | composition, rendering, transcription and matting front-end | Apache-2.0 | npm |
| [GSAP](https://gsap.com) 3.15 | animation timelines in generated compositions (copied into each `work/` project) | GSAP Standard "no charge" licence: free including commercial use, **except** no-code visual animation builders that compete with Webflow | npm |
| [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MCP server | MIT | npm |
| [zod](https://zod.dev), [yaml](https://eemeli.org/yaml) | schemas, style files | MIT, ISC | npm |
| [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), int8 ONNX export by [csukuangfj](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8) | default speech recognition | **CC BY 4.0**: attribution required, see below | `hyperframes models install parakeet` |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Parakeet runtime | Apache-2.0 | HyperFrames, on first use |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) + OpenAI Whisper weights (`large-v3-turbo`) | optional speech recognition | MIT | HyperFrames, built from source on first use |
| [U²-Net](https://github.com/xuebinqin/U-2-Net) `u2net_human_seg` | person matting | Apache-2.0 | HyperFrames, on first use |
| [ONNX Runtime](https://onnxruntime.ai) (onnxruntime-node) | matting runtime | MIT | HyperFrames, on first use |
| [FFmpeg](https://ffmpeg.org) | every audio/video operation, called as an external program | LGPL-2.1+ or GPL-2+ depending on your build | system package |
| Chrome / chrome-headless-shell | frame capture during render | Google Chrome terms / Chromium BSD-style | system or HyperFrames |
| Fonts bundled with HyperFrames (Inter, Montserrat, Oswald, League Gothic, Archivo Black, Playfair Display, JetBrains Mono, Poppins…) | typography | SIL Open Font License 1.1 | HyperFrames |

## Attribution

Speech recognition by default uses **Parakeet TDT 0.6B v3** by NVIDIA, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Background removal uses **U²-Net**
(Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*, Pattern
Recognition 2020).

## What studio does not use

- No paid API, no cloud service, no large language model at run time. The editorial decisions an LLM may take
  happen in the client that drives studio over MCP, outside this software.
- No telemetry: studio runs HyperFrames with `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` and
  `HYPERFRAMES_SKIP_SKILLS=1`.
- Not used, on licence grounds: Remotion (company licence above three people), RobustVideoMatting (GPL-3.0),
  MODNet weights (CC BY-NC-SA), BRIA RMBG (non-commercial / paid).

## Music and sound effects

The repository ships no audio. `scripts/fetch-sfx.sh` downloads a sound-effects library into `assets/sfx/`
(gitignored), from CC0 sources only, after checking each Kenney pack's licence file:

| Pack | Author | Licence | Used as |
|---|---|---|---|
| [Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 1.0 | pops, clicks |
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 1.0 | hits |
| [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) | Kenney | CC0 1.0 | glitches (computer noise, force field, cut to 0.5 s) |
| [Swishes Sound Pack](https://opengameart.org/content/swishes-sound-pack) | artisticdude | CC0 1.0 | whooshes |

Without the library, effects are synthesised with FFmpeg expressions (`src/steps/audio.ts`), with no licence
attached. Music placed in `assets/music/` is the user's responsibility: use tracks you hold the rights to.

## Test fixture

`scripts/make-fixture.sh` builds a synthetic test rush with [Piper](https://github.com/rhasspy/piper)
(MIT) and the `fr_FR-siwis-medium` voice. Neither the voice nor the generated rush is committed.
