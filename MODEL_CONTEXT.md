# AI Teacher Model Context

Last updated: 2026-04-12
Repo: `i0mar/ai-teacher`
Branch: `main`
Commit: `7068423` (`Add ElevenLabs narration and improve board planning`)

This file is a handoff for Claude or any other model working in this repo. It summarizes the project, the architecture, the important code paths, and the decisions made in the recent conversation. It is intentionally opinionated and operational, not marketing copy.

## 1. Project Summary

`ai-teacher` is an ASP.NET Core Razor Pages app for SAT tutoring. It has four main product surfaces:

- Lesson generation and playback
- Realtime voice tutoring with a live whiteboard
- Practice exams and answer review
- Video-style narrated explanations for questions and lessons

The app stores generated exams and video jobs locally in JSON, and it can generate narration audio for lessons/explanations.

## 2. Tech Stack and Runtime

- Framework: ASP.NET Core Razor Pages
- Target framework: `net10.0`
- Main app entry: `Program.cs`
- Main AI orchestration: `Services/Ai/AiTeacherService.cs`
- Narration/audio sync: `Services/Videos/VideoNarrationService.cs`
- AI config: `Services/Ai/AiOptions.cs`
- Checked-in config: `appsettings.json`

Important note:

- `README.md` still mentions .NET 9 in prerequisites, but the actual project target is `net10.0` in `AiTeacher.csproj`.

## 3. Important Paths

- App entry and DI: `Program.cs`
- AI options: `Services/Ai/AiOptions.cs`
- Lesson/question generation: `Services/Ai/AiTeacherService.cs`
- OpenAI speech client: `Services/Ai/OpenAiSpeechClient.cs`
- ElevenLabs speech client: `Services/Ai/ElevenLabsSpeechClient.cs`
- Narration pipeline: `Services/Videos/VideoNarrationService.cs`
- Realtime whiteboard coordination: `Services/Ai/RealtimeWhiteboardCoordinator.cs`
- Lesson/video watch page: `Pages/Videos/Watch.cshtml`
- Frontend whiteboard/sync logic: `wwwroot/js/site.js`
- About page / product notes: `Pages/About.cshtml`
- Data:
  - `App_Data/exams.generated.json`
  - `App_Data/videos.json`
  - generated narration audio under `wwwroot/generated/audio/`

## 4. Current AI Provider Architecture

The app now treats lesson generation and lesson narration as separate provider decisions.

- `Ai__Provider` controls the chat/generation side.
- `Ai__TtsProvider` controls narration audio generation.

Current design:

- OpenAI is used for lesson generation, question explanation generation, and realtime tutoring.
- OpenAI TTS is still supported.
- ElevenLabs can be used only for narration TTS while leaving generation on OpenAI.

This split is configured in:

- `Program.cs`
- `Services/Ai/AiOptions.cs`

DI behavior:

- `IAiChatClient` resolves to `OpenAiChatClient` or `StubAiChatClient`
- `IAiSpeechClient` resolves independently to `OpenAiSpeechClient`, `ElevenLabsSpeechClient`, or `StubAiSpeechClient`

## 5. Checked-in Defaults vs Typical Local Runtime

Checked-in defaults in `appsettings.json`:

- `Ai.Provider = Stub`
- `Ai.TtsProvider = OpenAI`
- OpenAI TTS instructions use the teacher-style prompt
- ElevenLabs defaults are present for voice/model/settings, but `ApiKey` is blank

Typical local runtime used in the recent conversation:

- `Ai__Provider=OpenAI`
- `Ai__OpenAi__Model=gpt-5.4`
- `Ai__OpenAi__RealtimeModel=gpt-realtime`
- `Ai__OpenAi__RealtimeVoice=marin`
- `Ai__OpenAi__RealtimeTranscriptionModel=gpt-4o-mini-transcribe`
- `Ai__TtsProvider=ElevenLabs`
- `Ai__ElevenLabs__VoiceId=RaFzMbMIfqBcIurH6XF9`
- `Ai__ElevenLabs__ModelId=eleven_multilingual_v2`
- `Ai__ElevenLabs__OutputFormat=mp3_44100_128`
- `Ai__ElevenLabs__Speed=1.0`
- `Ai__ElevenLabs__Stability=0.5`
- `Ai__ElevenLabs__SimilarityBoost=0.75`
- `Ai__ElevenLabs__Style=0.5`
- `Ai__ElevenLabs__UseSpeakerBoost=true`

Voice selection used most recently:

- ElevenLabs voice: `Eryn - Informative, Neutral and Measured`
- Voice ID: `RaFzMbMIfqBcIurH6XF9`

## 6. Lesson Generation Contract

When OpenAI generates a lesson pack, the prompt requires four sections:

- `NARRATION`
- `SPOKEN_LINES`
- `WHITEBOARD`
- `TIMINGS`

Meaning:

- `NARRATION`: the full spoken lesson script
- `SPOKEN_LINES`: one spoken beat per board step
- `WHITEBOARD`: one board line per step
- `TIMINGS`: one planned start time per board line

Key invariant:

- `SPOKEN_LINES`, `WHITEBOARD`, and `TIMINGS` must have the same count
- Item `i` in each list is the same teaching beat

The generation logic lives in:

- `Services/Ai/AiTeacherService.cs`

## 7. Lesson Generation Pipeline

Current flow for lesson videos:

1. Topic and lesson type are analyzed in `AiTeacherService`.
2. The prompt is built with required structure and topic-specific visual rules.
3. OpenAI generates:
   - full narration
   - beat-aligned spoken lines
   - whiteboard plan
   - planned timings
4. The result is parsed into `AiVideoPack`.
5. The pack is repaired if needed:
   - board alignment repair
   - beat sync repair
   - math visual enforcement
   - fallback board generation if the model drifts
6. If narration audio is requested, `VideoNarrationService` synthesizes audio and tries to derive real board timestamps from the final audio.

The system uses OpenAI-generated `TIMINGS` as a planning aid, but prefers audio-derived timestamps when available.

## 8. Whiteboard Writing Rules

This was a major focus of the recent conversation.

Current goal:

- The board should look like a real teacher whiteboard.
- It should not be made of full narration sentences.

Current board style rules:

- Prefer equations, labels, short prompts, key terms, and step fragments.
- Avoid sentence-style prose on the board.
- Use concise transformations like:
  - `Divide by 3`
  - `Substitute: x=4`
  - `Check: 3(4)=12`
  - `m = 2, b = 1`

Bad examples:

- `Today we will learn about photosynthesis.`
- `We divide both sides by 3 to isolate x.`

Better versions:

- `Photosynthesis`
- `Divide by 3`
- `x = 4`

This is enforced in two ways:

- Prompt-level rules in `AiTeacherService`
- Post-generation cleanup via `PolishGeneratedBoardLines(...)`

Important recent change:

- The repair step now treats verbose board sentences as a defect, not just extremely long lines.

## 9. Board/Audio Sync Model

The whiteboard sync system is stronger than simple evenly spaced timings.

There are two timing concepts:

- `BoardTimings`: normalized fractions / planned timings from generation
- `BoardTimestampSeconds`: real timestamps in seconds used for playback when available

Current sync strategy:

1. OpenAI generates planned `TIMINGS`.
2. Narration audio is synthesized.
3. The app tries to derive exact board start timestamps from real spoken audio.
4. If exact timing is not available, it falls back to scaled timestamp seconds or scaled timing fractions.

This logic lives mainly in:

- `Services/Videos/VideoNarrationService.cs`

Important detail:

- The app tries to sync the board to what was actually spoken, not just to what the model predicted.

## 10. ElevenLabs Integration

ElevenLabs is now a first-class narration provider in:

- `Services/Ai/ElevenLabsSpeechClient.cs`

Current behavior:

- The client calls `POST /v1/text-to-speech/{voice_id}/with-timestamps`
- It passes model and voice settings
- It receives:
  - `audio_base64`
  - alignment data
- It converts alignment data into `AiSpeechWordTiming`
- It caches timings by prompt so the narration service can retrieve them after synthesis

Important clarification:

- The endpoint path stays under `/v1/...`
- The model used is `eleven_multilingual_v2`
- The `v2` is the model version, not an API route version

## 11. Do We Get Timestamps from ElevenLabs?

Yes.

For the current runtime setup:

- OpenAI generates the lesson pack
- ElevenLabs generates narration audio
- ElevenLabs also returns alignment metadata through `/with-timestamps`
- The app converts that alignment into word timings
- `VideoNarrationService` uses those timings to compute board timestamps

So with ElevenLabs enabled for TTS, the board sync path uses real ElevenLabs alignment data whenever possible.

## 12. OpenAI TTS Teacher Prompt

OpenAI TTS instructions were updated to sound like a real teacher, not an ad or audiobook voice. The checked-in default prompt in `appsettings.json` emphasizes:

- warm, calm, clear, encouraging tone
- moderate pace
- short pauses after important ideas
- slight slowdown for formulas/definitions/steps
- simple explanation first, precision second
- no influencer energy
- no robotic rhythm
- no commercial voiceover feel

This applies only when `Ai__TtsProvider=OpenAI`.

## 13. ElevenLabs Transcript Writing Rules

Because ElevenLabs does not accept an equivalent free-form narration-instructions field on this path, the lesson-generation prompts were changed so OpenAI writes transcripts in a way that performs better in ElevenLabs.

Those rules include:

- short sentences
- short paragraphs
- light filler words only when useful
- rhetorical questions occasionally
- commas for short pauses
- ellipses for longer pauses
- natural teacher cadence

The prompt includes an explicit cadence example:

```text
Okay... so here's the idea.
When you heat water, something interesting happens.
It starts to move faster... right?
```

These rules were wired into:

- lesson generation
- solution explanation generation
- in-lesson Q&A generation
- narration rewrite / board-sync repair prompts

## 14. DRAW Commands and Visual Rules

The watch player can render simple whiteboard visuals using `DRAW:` lines. These are stored inside the normal board sequence and must still have timings.

Examples:

- `DRAW: axes x=-5..5 y=-5..5`
- `DRAW: line y=2x+1`
- `DRAW: point (3,7) label=(3,7)`
- `DRAW: focus (3,7)`
- `DRAW: triangle right; legs a,b; hypotenuse c`
- `DRAW: bar Old=50 New=60`
- `DRAW: clear`

`AiTeacherService` contains substantial topic-specific logic for deciding when visuals are required and for normalizing/repairing `DRAW:` usage.

## 15. Realtime Tutor Surface

The app also includes a realtime tutoring mode using:

- `OpenAiRealtimeClient`
- `RealtimeWhiteboardCoordinator`

This is separate from the lesson/video generation flow. The recent conversation did not materially change that feature, but it is part of the overall project.

## 16. Current Local URLs

When the app is run locally, the usual URLs are:

- `http://localhost:5154`
- `https://localhost:7154`

The ASP.NET dev certificate may be untrusted locally, so HTTP is usually the safer quick path.

## 17. Conversation Decision Log

The following changes were made during the recent conversation:

1. Pushed prior work to GitHub.
2. Updated OpenAI TTS instructions to a teacher-style voice prompt.
3. Implemented `Ai__TtsProvider` so narration TTS can be split from lesson generation.
4. Added `ElevenLabsSpeechClient`.
5. Added ElevenLabs settings to config and DI.
6. Switched runtime narration to ElevenLabs while keeping OpenAI for generation.
7. Added ElevenLabs-specific transcript-writing rules to lesson-generation prompts.
8. Added a concrete cadence example to the prompt.
9. Strengthened board timestamp fallback logic in `VideoNarrationService`.
10. Switched ElevenLabs narration settings to:
   - voice `Eryn`
   - `eleven_multilingual_v2`
   - speed `1.0`
   - stability `0.5`
   - similarity boost `0.75`
   - style `0.5`
   - speaker boost `true`
11. Clarified that OpenAI generates `NARRATION`, `SPOKEN_LINES`, `WHITEBOARD`, and `TIMINGS`.
12. Clarified that ElevenLabs only voices the text and returns alignment metadata.
13. Improved board-writing behavior so the board uses notes/fragments rather than sentence-like prose.
14. Pushed these changes to GitHub in commit `7068423`.

## 18. Security Notes

Important:

- The user pasted real-looking OpenAI and ElevenLabs keys into chat during the conversation.
- Those keys were used only as runtime environment variables.
- They were not written into tracked files by design.
- Because they were pasted into chat, they should be treated as exposed and rotated.

This document intentionally does not include the actual keys.

## 19. Current Git State

As of writing this file:

- latest pushed commit: `7068423`
- branch: `main`
- remote: `ai-teacher-github`

If this file is added after that commit, expect the worktree to be dirty until it is committed.

## 20. Recommended Files for Another Model to Read First

If another model needs to understand or modify the current lesson pipeline, read these in order:

1. `MODEL_CONTEXT.md`
2. `README.md`
3. `Program.cs`
4. `Services/Ai/AiOptions.cs`
5. `Services/Ai/AiTeacherService.cs`
6. `Services/Ai/ElevenLabsSpeechClient.cs`
7. `Services/Ai/OpenAiSpeechClient.cs`
8. `Services/Videos/VideoNarrationService.cs`
9. `wwwroot/js/site.js`

## 21. Practical Next-Step Ideas

High-value follow-up improvements, if needed:

- tighten README so it matches the actual `net10.0` target
- add tests around board-line polishing and sync fallback behavior
- add a small integration smoke test for ElevenLabs alignment mapping
- expose selected TTS provider and voice in the UI for debugging
- add a debug view that shows:
  - `WHITEBOARD`
  - `SPOKEN_LINES`
  - planned `TIMINGS`
  - resolved `BoardTimestampSeconds`

