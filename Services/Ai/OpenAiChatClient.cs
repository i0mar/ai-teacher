using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class OpenAiChatClient : IAiChatClient
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly AiOptions _options;

    public OpenAiChatClient(HttpClient http, IOptions<AiOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    public async Task<string> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken ct)
    {
        var apiKey = _options.OpenAi.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("OpenAI API key missing. Set Ai:OpenAi:ApiKey (or Ai__OpenAi__ApiKey).");

        var baseUrl = _options.OpenAi.BaseUrl?.Trim();
        if (string.IsNullOrWhiteSpace(baseUrl))
            baseUrl = "https://api.openai.com";

        var request = new ChatCompletionRequest
        {
            Model = _options.OpenAi.Model,
            Temperature = 0.3,
            Messages = new List<ChatMessage>
            {
                new() { Role = "system", Content = systemPrompt },
                new() { Role = "user", Content = userPrompt }
            }
        };

        var requestJson = JsonSerializer.Serialize(request, SerializerOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(baseUrl), "/v1/chat/completions"))
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await _http.SendAsync(message, ct);
        var responseJson = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"OpenAI API error ({(int)response.StatusCode}): {responseJson}");

        var parsed = JsonSerializer.Deserialize<ChatCompletionResponse>(responseJson, SerializerOptions);
        var content = parsed?.Choices?.FirstOrDefault()?.Message?.Content?.Trim();
        return string.IsNullOrWhiteSpace(content) ? "(No content returned by the model.)" : content;
    }

    private sealed class ChatCompletionRequest
    {
        public string Model { get; set; } = "";
        public double Temperature { get; set; } = 0.3;
        public List<ChatMessage> Messages { get; set; } = new();
    }

    private sealed class ChatMessage
    {
        public string Role { get; set; } = "";
        public string Content { get; set; } = "";
    }

    private sealed class ChatCompletionResponse
    {
        public List<ChatChoice> Choices { get; set; } = new();
    }

    private sealed class ChatChoice
    {
        public ChatMessage Message { get; set; } = new();
    }
}

