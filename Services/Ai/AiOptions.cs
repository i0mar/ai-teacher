namespace AiTeacher.Services.Ai;

public sealed class AiOptions
{
    public string Provider { get; set; } = "Stub";
    public OpenAiOptions OpenAi { get; set; } = new();
}

public sealed class OpenAiOptions
{
    public string BaseUrl { get; set; } = "https://api.openai.com";
    public string Model { get; set; } = "gpt-4o-mini";
    public string ImageModel { get; set; } = "gpt-image-1";
    public string TtsModel { get; set; } = "tts-1";
    public string TtsVoice { get; set; } = "alloy";
    public string? ApiKey { get; set; }
}
