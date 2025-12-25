using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class OpenAiSpeechClient : IAiSpeechClient
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly AiOptions _options;

    public OpenAiSpeechClient(HttpClient http, IOptions<AiOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    public async Task<byte[]?> SynthesizeMp3Async(string text, CancellationToken ct)
    {
        var apiKey = _options.OpenAi.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            return null;

        var baseUrl = _options.OpenAi.BaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = "https://api.openai.com";

        var model = string.IsNullOrWhiteSpace(_options.OpenAi.TtsModel) ? "tts-1" : _options.OpenAi.TtsModel.Trim();
        var voice = string.IsNullOrWhiteSpace(_options.OpenAi.TtsVoice) ? "alloy" : _options.OpenAi.TtsVoice.Trim();

        var request = new SpeechRequest
        {
            Model = model,
            Voice = voice,
            Format = "mp3",
            Input = text
        };

        var requestJson = JsonSerializer.Serialize(request, SerializerOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "/v1/audio/speech"))
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await _http.SendAsync(message, ct);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"OpenAI TTS error ({(int)response.StatusCode}): {error}");
        }

        return await response.Content.ReadAsByteArrayAsync(ct);
    }

    private sealed class SpeechRequest
    {
        public string Model { get; set; } = "tts-1";
        public string Voice { get; set; } = "alloy";
        public string Format { get; set; } = "mp3";
        public string Input { get; set; } = "";
    }
}

