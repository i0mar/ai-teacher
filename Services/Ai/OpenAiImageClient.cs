using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class OpenAiImageClient : IAiImageClient
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly AiOptions _options;

    public OpenAiImageClient(HttpClient http, IOptions<AiOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    public async Task<byte[]?> GeneratePngAsync(string prompt, CancellationToken ct)
    {
        var apiKey = _options.OpenAi.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            return null;

        var baseUrl = _options.OpenAi.BaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = "https://api.openai.com";

        var model = string.IsNullOrWhiteSpace(_options.OpenAi.ImageModel) ? "gpt-image-1" : _options.OpenAi.ImageModel.Trim();

        var request = new ImageGenerationRequest
        {
            Model = model,
            Prompt = prompt,
            Size = "1024x1024",
            N = 1,
            ResponseFormat = "b64_json"
        };

        var requestJson = JsonSerializer.Serialize(request, SerializerOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "/v1/images/generations"))
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await _http.SendAsync(message, ct);
        var responseJson = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"OpenAI images error ({(int)response.StatusCode}): {responseJson}");

        var parsed = JsonSerializer.Deserialize<ImageGenerationResponse>(responseJson, SerializerOptions);
        var b64 = parsed?.Data?.FirstOrDefault()?.B64Json;
        if (string.IsNullOrWhiteSpace(b64))
            return null;

        return Convert.FromBase64String(b64);
    }

    private sealed class ImageGenerationRequest
    {
        public string Model { get; set; } = "gpt-image-1";
        public string Prompt { get; set; } = "";
        public string Size { get; set; } = "1024x1024";
        public int N { get; set; } = 1;

        [JsonPropertyName("response_format")]
        public string ResponseFormat { get; set; } = "b64_json";
    }

    private sealed class ImageGenerationResponse
    {
        public List<ImageData> Data { get; set; } = new();
    }

    private sealed class ImageData
    {
        [JsonPropertyName("b64_json")]
        public string? B64Json { get; set; }

        public string? Url { get; set; }
    }
}

