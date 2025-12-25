# AI SAT Teacher (ASP.NET Core)

An ASP.NET Core Razor Pages web app for an online AI SAT tutor. It includes:

- SAT lessons: generate a lesson script and “watch” it using a built-in narrated player (browser text-to-speech).
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
export Ai__OpenAi__Model="gpt-5.2"
export Ai__OpenAi__TtsModel="tts-1"
export Ai__OpenAi__TtsVoice="alloy"
```

Notes:

- The app calls the OpenAI Chat Completions API via `HttpClient` (no extra NuGet packages).
- If OpenAI is enabled, the app can also generate narration audio files for “videos” (OpenAI TTS). Otherwise it falls back to browser speech synthesis.

## Data locations

- Generated exams: `App_Data/exams.generated.json`
- Video jobs: `App_Data/videos.json`
- Generated narration audio (if enabled): `wwwroot/generated/audio/`
