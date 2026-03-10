using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class OpenAiSpeechClient : IAiSpeechClient
{
    private const int MaxTranscriptionPromptChars = 3000;
    private const string DefaultNarrationInstructions =
        "Voice Affect: Warm adult woman with a subtle Southern U.S. accent.\n" +
        "Tone: Friendly, confident classroom teacher.\n" +
        "Pacing: Conversational and steady, with short pauses after key math steps.\n" +
        "Emotion: Calm, encouraging, and natural.\n" +
        "Delivery: Sound like a real one-on-one tutor from the American South, not a voice assistant.";

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly AiOptions _options;
    private readonly ILogger<OpenAiSpeechClient> _logger;

    public OpenAiSpeechClient(HttpClient http, IOptions<AiOptions> options, ILogger<OpenAiSpeechClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<byte[]?> SynthesizeWavAsync(string text, CancellationToken ct)
    {
        var apiKey = _options.OpenAi.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            return null;

        var baseUrl = _options.OpenAi.BaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = "https://api.openai.com";

        var model = string.IsNullOrWhiteSpace(_options.OpenAi.TtsModel) ? "gpt-4o-mini-tts" : _options.OpenAi.TtsModel.Trim();
        var voice = string.IsNullOrWhiteSpace(_options.OpenAi.TtsVoice) ? "marin" : _options.OpenAi.TtsVoice.Trim();
        var speed = _options.OpenAi.TtsSpeed;
        if (!double.IsFinite(speed) || speed <= 0)
            speed = 1.0;
        speed = Math.Clamp(speed, 0.25, 2.0);
        var instructions = SupportsInstructions(model)
            ? BuildNarrationInstructions(_options.OpenAi.TtsInstructions)
            : null;

        var request = new SpeechRequest
        {
            Model = model,
            Voice = voice,
            ResponseFormat = "wav",
            Input = text,
            Speed = speed,
            Instructions = instructions
        };

        var requestJson = JsonSerializer.Serialize(request, SerializerOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "/v1/audio/speech"))
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await _http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"OpenAI TTS error ({(int)response.StatusCode}): {error}");
        }

        var mediaType = response.Content.Headers.ContentType?.MediaType ?? "(unknown)";
        if (!mediaType.Contains("wav", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning(
                "OpenAI TTS returned content type {MediaType} even though WAV was requested. The app will normalize it locally.",
                mediaType);
        }

        await using var responseStream = await response.Content.ReadAsStreamAsync(ct);
        await using var buffer = new MemoryStream();
        await responseStream.CopyToAsync(buffer, ct);
        return buffer.ToArray();
    }

    public async Task<IReadOnlyList<AiSpeechWordTiming>> TryTranscribeWordTimingsAsync(byte[] audioBytes, string? prompt, CancellationToken ct)
    {
        if (audioBytes is null || audioBytes.Length == 0)
            return Array.Empty<AiSpeechWordTiming>();

        var apiKey = _options.OpenAi.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            return Array.Empty<AiSpeechWordTiming>();

        var baseUrl = _options.OpenAi.BaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = "https://api.openai.com";

        var model = string.IsNullOrWhiteSpace(_options.OpenAi.TranscriptionModel)
            ? "whisper-1"
            : _options.OpenAi.TranscriptionModel.Trim();

        using var form = new MultipartFormDataContent();
        var audioContent = new ByteArrayContent(audioBytes);
        audioContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        form.Add(audioContent, "file", "narration.wav");
        form.Add(new StringContent(model, Encoding.UTF8), "model");
        form.Add(new StringContent("verbose_json", Encoding.UTF8), "response_format");
        form.Add(new StringContent("word", Encoding.UTF8), "timestamp_granularities[]");

        var promptText = (prompt ?? "").Trim();
        if (promptText.Length > 0)
        {
            if (promptText.Length > MaxTranscriptionPromptChars)
                promptText = promptText[..MaxTranscriptionPromptChars];
            form.Add(new StringContent(promptText, Encoding.UTF8), "prompt");
        }

        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "/v1/audio/transcriptions"))
        {
            Content = form
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        try
        {
            using var response = await _http.SendAsync(message, ct);
            var responseJson = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("OpenAI transcription error ({StatusCode}): {Body}", (int)response.StatusCode, responseJson);
                return Array.Empty<AiSpeechWordTiming>();
            }

            var parsed = JsonSerializer.Deserialize<TranscriptionResponse>(responseJson, SerializerOptions);
            if (parsed?.Words is null || parsed.Words.Count == 0)
                return Array.Empty<AiSpeechWordTiming>();

            return parsed.Words
                .Where(w => !string.IsNullOrWhiteSpace(w.Word) && double.IsFinite(w.Start) && double.IsFinite(w.End))
                .Select(w => new AiSpeechWordTiming(w.Word.Trim(), Math.Max(0, w.Start), Math.Max(0, w.End)))
                .Where(w => w.EndSeconds >= w.StartSeconds)
                .ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to transcribe generated narration audio for timing alignment.");
            return Array.Empty<AiSpeechWordTiming>();
        }
    }

    private static bool SupportsInstructions(string model) =>
        model.Contains("gpt-4o-mini-tts", StringComparison.OrdinalIgnoreCase);

    private static string BuildNarrationInstructions(string? configuredInstructions)
    {
        var text = (configuredInstructions ?? "").Trim();
        return string.IsNullOrWhiteSpace(text) ? DefaultNarrationInstructions : text;
    }

    private sealed class SpeechRequest
    {
        public string Model { get; set; } = "gpt-4o-mini-tts";
        public string Voice { get; set; } = "marin";
        public string ResponseFormat { get; set; } = "wav";
        public string Input { get; set; } = "";
        public double Speed { get; set; } = 1.0;
        public string? Instructions { get; set; }
    }

    private sealed class TranscriptionResponse
    {
        public List<TranscriptionWord> Words { get; set; } = new();
    }

    private sealed class TranscriptionWord
    {
        public string Word { get; set; } = "";
        public double Start { get; set; }
        public double End { get; set; }
    }
}
