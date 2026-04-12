# AI SAT Teacher (ASP.NET Core)

An ASP.NET Core Razor Pages web app for an online AI SAT tutor. It includes:

- SAT lessons: generate a lesson script and “watch” it in a narrated whiteboard player.
- Live tutor: start a real-time voice lesson with live whiteboard writing and interruptions.
- Practice exams: take original mini practice exams and review results.
- AI explanations: generate step-by-step explanations for each question.
- Video jobs: turn lesson scripts or solution explanations into “video” sessions (script + narration).

## Prerequisites

- .NET 9 SDK (installed on your machine); or change `AiTeacher.csproj` to target `net8.0` if you install .NET 8.

## Run

```bash
dotnet run
```

Then open the URL shown in the console (usually `http://localhost:5xxx`).

## Configure the AI provider

By default the app runs in `Stub` mode (no external calls). To use OpenAI:

```bash
export Ai__Provider=OpenAI
export Ai__OpenAi__ApiKey="OPENAI_API_KEY"
export Ai__OpenAi__Model="gpt-5.4"
export Ai__OpenAi__RealtimeModel="gpt-realtime"
export Ai__OpenAi__RealtimeVoice="marin"
export Ai__OpenAi__RealtimeTranscriptionModel="gpt-4o-mini-transcribe"
export Ai__OpenAi__TtsModel="gpt-4o-mini-tts"
export Ai__OpenAi__TtsVoice="marin"
export Ai__OpenAi__TtsInstructions="You are an excellent teacher speaking to a learner, not performing a commercial voiceover. Voice style: Warm, calm, clear, encouraging, and confident. Sound like a real teacher explaining concepts to a student one-on-one. Prioritize clarity over drama. Use natural conversational emphasis, not exaggerated acting. Speak at a moderate pace with brief pauses after important ideas. Slightly slow down for definitions, formulas, steps, and key takeaways. Vary intonation naturally so the lesson feels alive and human. Teaching style: Explain ideas in simple language first, then add precision. Introduce one idea at a time. Emphasize key terms and transitions. When helpful, use short examples or analogies. Occasionally sound reassuring, as if checking that the learner is following. End sections with a concise takeaway. Avoid: Overly excited influencer energy. Robotic rhythm. Rushing through lists. Overly theatrical narration. Sounding like an ad, announcer, or audiobook actor."
```

To keep OpenAI for lesson generation but switch narrated lesson audio to ElevenLabs:

```bash
export Ai__TtsProvider=ElevenLabs
export Ai__ElevenLabs__ApiKey="ELEVENLABS_API_KEY"
export Ai__ElevenLabs__VoiceId="YOUR_ELEVENLABS_VOICE_ID"
export Ai__ElevenLabs__ModelId="eleven_multilingual_v2"
export Ai__ElevenLabs__OutputFormat="mp3_44100_128"
```

Notes:

- The app calls the OpenAI Chat Completions API via `HttpClient` (no extra NuGet packages).
- The new `Live Tutor` tab uses the OpenAI Realtime API over WebRTC. It streams tutor audio, then a separate board coordinator mirrors the live tutor transcript onto the lesson-style whiteboard in incremental updates using the current board state and conversation context. Student voice interruptions are handled live by server VAD.
- Realtime voices differ from the TTS voices. Use a current Realtime voice such as `coral`, `sage`, `ash`, or `verse`.
- Narrated lesson audio can come from either OpenAI TTS or ElevenLabs. Set `Ai__TtsProvider=OpenAI` or `Ai__TtsProvider=ElevenLabs`.
- ElevenLabs narration uses `POST /v1/text-to-speech/{voice_id}/with-timestamps`, so the app can derive board timestamps directly from ElevenLabs alignment data.
- `Ai__OpenAi__TtsInstructions` only affects OpenAI TTS. ElevenLabs does not accept a free-form narration-instructions field on this endpoint, so use a suitable voice plus ElevenLabs voice settings instead.
- The default ElevenLabs output format is `mp3_44100_128`, which the app normalizes to WAV locally before storing the generated lesson audio.

## Data locations

- Generated exams: `App_Data/exams.generated.json`
- Video jobs: `App_Data/videos.json`
- Generated narration audio (if enabled): `wwwroot/generated/audio/`

## Whiteboard graphs / drawings

The “Watch” player can render simple diagrams on the whiteboard. Any whiteboard line that starts with `DRAW:` is treated as a drawing instruction (instead of text) and is rendered on the right side of the board.

Examples:

- `DRAW: axes x=-5..5 y=-5..5`
- `DRAW: line y=2x+1`
- `DRAW: point (3,7) label=(3,7)`
- `DRAW: focus (3,7)`
- `DRAW: bar Old=50 New=60`
- `DRAW: focus bar New`
- `DRAW: triangle right 3 4 5`
- `DRAW: focus hyp`
- `DRAW: clear`

These `DRAW:` lines still count as whiteboard lines, so `BoardTimings` must include a matching timing entry for each one.

## Timestamp-based board sync

Board narration sync now uses clock-style timestamps for each whiteboard line.

- In AI output, `TIMINGS` should be `MM:SS` (or `HH:MM:SS`) and strictly increasing.
- Older formats (`0.25`, `25%`) are still accepted for backward compatibility.
- The watch page includes a **Board Timing Plan** list so you can see exactly when each line should be written.
