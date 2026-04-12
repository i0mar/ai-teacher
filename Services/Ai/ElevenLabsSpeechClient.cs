using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class ElevenLabsSpeechClient : IAiSpeechClient
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    // ElevenLabs returns timing metadata as part of synthesis, while the narration
    // pipeline asks for timings in a separate step after audio normalization.
    private readonly ConcurrentDictionary<string, ConcurrentQueue<IReadOnlyList<AiSpeechWordTiming>>> _timingsByPrompt = new(StringComparer.Ordinal);

    private readonly HttpClient _http;
    private readonly AiOptions _options;
    private readonly ILogger<ElevenLabsSpeechClient> _logger;

    public ElevenLabsSpeechClient(HttpClient http, IOptions<AiOptions> options, ILogger<ElevenLabsSpeechClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<byte[]?> SynthesizeWavAsync(string text, CancellationToken ct)
    {
        var apiKey = _options.GetElevenLabsApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            _logger.LogWarning("ElevenLabs API key missing. Set Ai:ElevenLabs:ApiKey or ELEVENLABS_API_KEY.");
            return null;
        }

        var voiceId = (_options.ElevenLabs.VoiceId ?? "").Trim();
        if (voiceId.Length == 0)
        {
            _logger.LogWarning("ElevenLabs voice id missing. Set Ai:ElevenLabs:VoiceId.");
            return null;
        }

        var baseUrl = (_options.ElevenLabs.BaseUrl ?? "").Trim();
        if (baseUrl.Length == 0)
            baseUrl = "https://api.elevenlabs.io";

        var outputFormat = (_options.ElevenLabs.OutputFormat ?? "").Trim();
        if (outputFormat.Length == 0)
            outputFormat = "mp3_44100_128";

        var request = new ElevenLabsSpeechRequest
        {
            Text = text,
            ModelId = string.IsNullOrWhiteSpace(_options.ElevenLabs.ModelId)
                ? "eleven_multilingual_v2"
                : _options.ElevenLabs.ModelId.Trim(),
            LanguageCode = string.IsNullOrWhiteSpace(_options.ElevenLabs.LanguageCode)
                ? null
                : _options.ElevenLabs.LanguageCode.Trim(),
            VoiceSettings = BuildVoiceSettings(_options.ElevenLabs)
        };

        var baseUri = new Uri($"{baseUrl.TrimEnd('/')}/", UriKind.Absolute);
        var requestUriBuilder = new UriBuilder(new Uri(baseUri, $"v1/text-to-speech/{Uri.EscapeDataString(voiceId)}/with-timestamps"))
        {
            Query = $"output_format={Uri.EscapeDataString(outputFormat)}"
        };

        var requestJson = JsonSerializer.Serialize(request, SerializerOptions);
        using var message = new HttpRequestMessage(HttpMethod.Post, requestUriBuilder.Uri)
        {
            Content = new StringContent(requestJson, Encoding.UTF8, "application/json")
        };
        message.Headers.Add("xi-api-key", apiKey);

        using var response = await _http.SendAsync(message, ct);
        var responseJson = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"ElevenLabs TTS error ({(int)response.StatusCode}): {responseJson}");

        var parsed = JsonSerializer.Deserialize<ElevenLabsSpeechResponse>(responseJson, SerializerOptions);
        if (parsed is null || string.IsNullOrWhiteSpace(parsed.AudioBase64))
        {
            _logger.LogWarning("ElevenLabs TTS returned an empty audio payload.");
            return null;
        }

        byte[] audioBytes;
        try
        {
            audioBytes = Convert.FromBase64String(parsed.AudioBase64);
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException("ElevenLabs returned invalid base64 audio data.", ex);
        }

        var timings = BuildWordTimings(parsed.Alignment) ?? BuildWordTimings(parsed.NormalizedAlignment);
        CacheTimings(text, timings);
        return audioBytes;
    }

    public Task<IReadOnlyList<AiSpeechWordTiming>> TryTranscribeWordTimingsAsync(byte[] audioBytes, string? prompt, CancellationToken ct)
    {
        var cacheKey = BuildPromptCacheKey(prompt);
        if (cacheKey.Length == 0)
        {
            return Task.FromResult<IReadOnlyList<AiSpeechWordTiming>>(Array.Empty<AiSpeechWordTiming>());
        }

        if (_timingsByPrompt.TryGetValue(cacheKey, out var queue) && queue.TryDequeue(out var timings))
        {
            if (queue.IsEmpty)
                _timingsByPrompt.TryRemove(cacheKey, out _);

            return Task.FromResult(timings);
        }

        return Task.FromResult<IReadOnlyList<AiSpeechWordTiming>>(Array.Empty<AiSpeechWordTiming>());
    }

    private void CacheTimings(string prompt, IReadOnlyList<AiSpeechWordTiming> timings)
    {
        if (timings.Count == 0)
            return;

        var cacheKey = BuildPromptCacheKey(prompt);
        if (cacheKey.Length == 0)
            return;

        var queue = _timingsByPrompt.GetOrAdd(cacheKey, static _ => new ConcurrentQueue<IReadOnlyList<AiSpeechWordTiming>>());
        queue.Enqueue(timings);
    }

    private static string BuildPromptCacheKey(string? prompt) =>
        (prompt ?? "").Trim();

    private static ElevenLabsVoiceSettings? BuildVoiceSettings(ElevenLabsOptions options)
    {
        var settings = new ElevenLabsVoiceSettings();
        var hasAnyValue = false;

        if (options.Stability is double stability && double.IsFinite(stability))
        {
            settings.Stability = Math.Clamp(stability, 0.0, 1.0);
            hasAnyValue = true;
        }

        if (options.SimilarityBoost is double similarityBoost && double.IsFinite(similarityBoost))
        {
            settings.SimilarityBoost = Math.Clamp(similarityBoost, 0.0, 1.0);
            hasAnyValue = true;
        }

        if (options.Style is double style && double.IsFinite(style))
        {
            settings.Style = Math.Clamp(style, 0.0, 1.0);
            hasAnyValue = true;
        }

        if (options.UseSpeakerBoost is bool useSpeakerBoost)
        {
            settings.UseSpeakerBoost = useSpeakerBoost;
            hasAnyValue = true;
        }

        if (options.Speed is double speed && double.IsFinite(speed) && speed > 0.0)
        {
            settings.Speed = speed;
            hasAnyValue = true;
        }

        return hasAnyValue ? settings : null;
    }

    private static IReadOnlyList<AiSpeechWordTiming> BuildWordTimings(ElevenLabsAlignment? alignment)
    {
        if (alignment?.Characters is null ||
            alignment.CharacterStartTimesSeconds is null ||
            alignment.CharacterEndTimesSeconds is null)
        {
            return Array.Empty<AiSpeechWordTiming>();
        }

        var count = Math.Min(
            alignment.Characters.Count,
            Math.Min(alignment.CharacterStartTimesSeconds.Count, alignment.CharacterEndTimesSeconds.Count));
        if (count <= 0)
            return Array.Empty<AiSpeechWordTiming>();

        var words = new List<AiSpeechWordTiming>();
        var current = new StringBuilder();
        var currentStart = 0.0;
        var currentEnd = 0.0;

        void Flush()
        {
            if (current.Length == 0)
                return;

            var word = current.ToString().Trim('\'', '’');
            current.Clear();
            if (word.Length == 0)
                return;

            words.Add(new AiSpeechWordTiming(word, Math.Max(0.0, currentStart), Math.Max(currentStart, currentEnd)));
        }

        for (var i = 0; i < count; i++)
        {
            var piece = alignment.Characters[i] ?? "";
            if (piece.Length == 0)
            {
                Flush();
                continue;
            }

            var isWordPart = piece.All(IsWordPart);
            if (!isWordPart)
            {
                Flush();
                continue;
            }

            if (current.Length == 0)
                currentStart = alignment.CharacterStartTimesSeconds[i];

            current.Append(piece);
            currentEnd = alignment.CharacterEndTimesSeconds[i];
        }

        Flush();
        return words;
    }

    private static bool IsWordPart(char ch) =>
        char.IsLetterOrDigit(ch) || ch is '\'' or '’';

    private sealed class ElevenLabsSpeechRequest
    {
        [JsonPropertyName("text")]
        public string Text { get; set; } = "";

        [JsonPropertyName("model_id")]
        public string ModelId { get; set; } = "eleven_multilingual_v2";

        [JsonPropertyName("language_code")]
        public string? LanguageCode { get; set; }

        [JsonPropertyName("voice_settings")]
        public ElevenLabsVoiceSettings? VoiceSettings { get; set; }
    }

    private sealed class ElevenLabsVoiceSettings
    {
        [JsonPropertyName("stability")]
        public double? Stability { get; set; }

        [JsonPropertyName("similarity_boost")]
        public double? SimilarityBoost { get; set; }

        [JsonPropertyName("style")]
        public double? Style { get; set; }

        [JsonPropertyName("use_speaker_boost")]
        public bool? UseSpeakerBoost { get; set; }

        [JsonPropertyName("speed")]
        public double? Speed { get; set; }
    }

    private sealed class ElevenLabsSpeechResponse
    {
        [JsonPropertyName("audio_base64")]
        public string? AudioBase64 { get; set; }

        [JsonPropertyName("alignment")]
        public ElevenLabsAlignment? Alignment { get; set; }

        [JsonPropertyName("normalized_alignment")]
        public ElevenLabsAlignment? NormalizedAlignment { get; set; }
    }

    private sealed class ElevenLabsAlignment
    {
        [JsonPropertyName("characters")]
        public List<string> Characters { get; set; } = new();

        [JsonPropertyName("character_start_times_seconds")]
        public List<double> CharacterStartTimesSeconds { get; set; } = new();

        [JsonPropertyName("character_end_times_seconds")]
        public List<double> CharacterEndTimesSeconds { get; set; } = new();
    }
}
