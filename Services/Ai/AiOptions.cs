namespace AiTeacher.Services.Ai;

public sealed class AiOptions
{
    public string Provider { get; set; } = "Stub";
    public string? TtsProvider { get; set; }
    public OpenAiOptions OpenAi { get; set; } = new();
    public ElevenLabsOptions ElevenLabs { get; set; } = new();

    public bool UseOpenAi()
    {
        if (HasOpenAiApiKey())
            return true;

        return string.Equals(Provider?.Trim(), "OpenAI", StringComparison.OrdinalIgnoreCase);
    }

    public bool HasOpenAiApiKey() =>
        !string.IsNullOrWhiteSpace(GetOpenAiApiKey());

    public bool HasElevenLabsApiKey() =>
        !string.IsNullOrWhiteSpace(GetElevenLabsApiKey());

    public string? GetOpenAiApiKey()
    {
        var configured = OpenAi.ApiKey?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var fallback = Environment.GetEnvironmentVariable("OPENAI_API_KEY")?.Trim();
        return string.IsNullOrWhiteSpace(fallback) ? null : fallback;
    }

    public string? GetElevenLabsApiKey()
    {
        var configured = ElevenLabs.ApiKey?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var fallback = Environment.GetEnvironmentVariable("ELEVENLABS_API_KEY")?.Trim();
        return string.IsNullOrWhiteSpace(fallback) ? null : fallback;
    }

    public string ResolveTtsProvider()
    {
        var configured = TtsProvider?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        return UseOpenAi() ? "OpenAI" : "Stub";
    }
}

public sealed class OpenAiOptions
{
    public string BaseUrl { get; set; } = "https://api.openai.com";
    public string Model { get; set; } = "gpt-4o-mini";
    public int ChatTimeoutSeconds { get; set; } = 1200;
    public string RealtimeModel { get; set; } = "gpt-realtime";
    public string? RealtimeVoice { get; set; }
    public string RealtimeTranscriptionModel { get; set; } = "gpt-4o-mini-transcribe";
    public string TtsModel { get; set; } = "gpt-4o-mini-tts";
    public string TtsVoice { get; set; } = "marin";
    public double TtsSpeed { get; set; } = 1.0;
    public string? TtsInstructions { get; set; }
    public string TranscriptionModel { get; set; } = "whisper-1";
    public string? ApiKey { get; set; }
}

public sealed class ElevenLabsOptions
{
    public string BaseUrl { get; set; } = "https://api.elevenlabs.io";
    public string? VoiceId { get; set; }
    public string ModelId { get; set; } = "eleven_multilingual_v2";
    public string OutputFormat { get; set; } = "mp3_44100_128";
    public string? LanguageCode { get; set; }
    public double? Stability { get; set; }
    public double? SimilarityBoost { get; set; }
    public double? Style { get; set; }
    public bool? UseSpeakerBoost { get; set; }
    public double? Speed { get; set; }
    public string? ApiKey { get; set; }
}
