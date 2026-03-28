using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class OpenAiRealtimeClient
{
    private const int MaxCallCreateAttempts = 3;
    private static readonly HashSet<string> SupportedRealtimeVoices = new(StringComparer.OrdinalIgnoreCase)
    {
        "alloy",
        "ash",
        "ballad",
        "coral",
        "echo",
        "sage",
        "shimmer",
        "verse"
    };

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly HttpClient _http;
    private readonly AiOptions _options;
    private readonly ILogger<OpenAiRealtimeClient> _logger;

    public OpenAiRealtimeClient(
        HttpClient http,
        IOptions<AiOptions> options,
        ILogger<OpenAiRealtimeClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public bool IsConfigured()
    {
        return _options.UseOpenAi() && _options.HasOpenAiApiKey();
    }

    public async Task<string> CreateLessonCallAnswerSdpAsync(string offerSdp, string topic, CancellationToken ct)
    {
        if (!IsConfigured())
            throw new InvalidOperationException("Realtime tutoring requires a valid Ai__OpenAi__ApiKey.");

        var rawOfferSdp = offerSdp ?? "";
        if (string.IsNullOrWhiteSpace(rawOfferSdp))
            throw new InvalidOperationException("Missing WebRTC offer SDP.");

        var cleanTopic = SanitizeTopic(topic);
        if (string.IsNullOrWhiteSpace(cleanTopic))
            throw new InvalidOperationException("Enter a lesson topic before starting live mode.");

        var apiKey = _options.GetOpenAiApiKey()!.Trim();
        var baseUrl = string.IsNullOrWhiteSpace(_options.OpenAi.BaseUrl)
            ? "https://api.openai.com"
            : _options.OpenAi.BaseUrl.Trim();

        var session = new
        {
            type = "realtime",
            model = GetRealtimeModel(),
            audio = new
            {
                output = new
                {
                    voice = GetRealtimeVoice()
                }
            }
        };
        var sessionJson = JsonSerializer.Serialize(session, SerializerOptions);
        var endpoint = new Uri(new Uri(baseUrl), "/v1/realtime/calls");

        for (var attempt = 1; attempt <= MaxCallCreateAttempts; attempt++)
        {
            using var form = new MultipartFormDataContent();
            form.Add(
                new StringContent(rawOfferSdp, Encoding.UTF8, "application/sdp"),
                "sdp");
            form.Add(
                new StringContent(sessionJson, Encoding.UTF8),
                "session");

            using var message = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = form
            };
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/sdp"));

            using var response = await _http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (response.IsSuccessStatusCode)
                return body;

            var statusCode = (int)response.StatusCode;
            if ((statusCode == 502 || statusCode == 503 || statusCode == 504) && attempt < MaxCallCreateAttempts)
            {
                _logger.LogWarning(
                    "OpenAI Realtime call creation failed with {StatusCode} on attempt {Attempt}; retrying. Body: {Body}",
                    statusCode,
                    attempt,
                    body);
                await Task.Delay(TimeSpan.FromMilliseconds(400 * attempt), ct);
                continue;
            }

            _logger.LogWarning("OpenAI Realtime connection failed ({StatusCode}): {Body}", statusCode, body);
            throw new InvalidOperationException($"OpenAI Realtime error ({statusCode}): {body}");
        }

        throw new InvalidOperationException("OpenAI Realtime error: failed to create call.");
    }

    private string BuildLessonInstructions(string topic)
    {
        var configuredVoiceStyle = (_options.OpenAi.TtsInstructions ?? "").Trim();
        var voiceStyle = string.IsNullOrWhiteSpace(configuredVoiceStyle)
            ? "Voice Affect: Warm adult woman with a subtle Southern U.S. accent. Tone: Friendly, confident classroom teacher. Pacing: Conversational with short pauses after key steps. Delivery: Sound like a real one-on-one tutor from the American South."
            : configuredVoiceStyle;

        return
            $"You are a live SAT tutor in a two-way voice lesson. The lesson topic is: {topic}.\n\n" +
            "Primary behavior:\n" +
            "- Start immediately with a one-sentence welcome, then teach the first important concept.\n" +
            "- Speak naturally in short chunks so the student can interrupt at any time.\n" +
            "- If the student interrupts with speech or text, answer that interruption directly before deciding whether to resume the earlier thread.\n" +
            "- Keep explanations SAT-oriented, concrete, and step-by-step.\n" +
            "- Ask quick comprehension checks when useful.\n" +
            "- Never quote copyrighted SAT prompts.\n\n" +
            "Text output rules:\n" +
            "- Text modality is only for whiteboard writing.\n" +
            "- Never narrate in text.\n" +
            "- Write short standalone lines only.\n" +
            "- End each board line with a newline as soon as it should appear.\n" +
            "- Prefer equations, tiny reminders, labels, and short bullet-style notes.\n" +
            "- Use [clear] on its own line when the board should reset.\n" +
            "- Use [replace-last] followed by replacement text to revise the latest board line.\n" +
            "- Use [pop] on its own line to remove the latest board line.\n" +
            "- Keep the board concise and readable.\n\n" +
            "Voice style:\n" +
            $"{voiceStyle}";
    }

    private string GetRealtimeModel() =>
        string.IsNullOrWhiteSpace(_options.OpenAi.RealtimeModel)
            ? "gpt-realtime"
            : _options.OpenAi.RealtimeModel.Trim();

    private string GetRealtimeTranscriptionModel() =>
        string.IsNullOrWhiteSpace(_options.OpenAi.RealtimeTranscriptionModel)
            ? "gpt-4o-mini-transcribe"
            : _options.OpenAi.RealtimeTranscriptionModel.Trim();

    private string GetRealtimeVoice()
    {
        var configured = (_options.OpenAi.RealtimeVoice ?? "").Trim();
        if (!string.IsNullOrWhiteSpace(configured))
            return NormalizeRealtimeVoice(configured);

        var fallback = (_options.OpenAi.TtsVoice ?? "").Trim();
        return NormalizeRealtimeVoice(fallback);
    }

    private static string NormalizeRealtimeVoice(string? voice)
    {
        var candidate = (voice ?? "").Trim();
        if (SupportedRealtimeVoices.Contains(candidate))
            return candidate;

        return "coral";
    }

    private static string SanitizeTopic(string topic)
    {
        var cleaned = (topic ?? "").Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (cleaned.Length > 140)
            cleaned = cleaned[..140].TrimEnd();
        return cleaned;
    }
}
