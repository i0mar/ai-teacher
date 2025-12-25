using AiTeacher.Services.Ai;

namespace AiTeacher.Services.Videos;

public sealed class VideoNarrationService : IVideoNarrationService
{
    private const int MaxNarrationChars = 3500;

    private readonly IWebHostEnvironment _env;
    private readonly IAiSpeechClient _speech;
    private readonly ILogger<VideoNarrationService> _logger;

    public VideoNarrationService(IWebHostEnvironment env, IAiSpeechClient speech, ILogger<VideoNarrationService> logger)
    {
        _env = env;
        _speech = speech;
        _logger = logger;
    }

    public async Task<string?> TryGenerateAudioAsync(Guid videoId, string script, CancellationToken ct)
    {
        if (videoId == Guid.Empty)
            return null;

        if (string.IsNullOrWhiteSpace(script))
            return null;

        try
        {
            var narrationText = script.Trim();
            if (narrationText.Length > MaxNarrationChars)
                narrationText = narrationText.Substring(0, MaxNarrationChars) + "\n\n(Truncated for narration.)";

            var mp3 = await _speech.SynthesizeMp3Async(narrationText, ct);
            if (mp3 is null || mp3.Length == 0)
                return null;

            var webRoot = _env.WebRootPath;
            if (string.IsNullOrWhiteSpace(webRoot))
                webRoot = Path.Combine(_env.ContentRootPath, "wwwroot");

            var relativeUrl = $"/generated/audio/{videoId}.mp3";
            var filePath = Path.Combine(webRoot, "generated", "audio", $"{videoId}.mp3");

            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            await File.WriteAllBytesAsync(filePath, mp3, ct);

            return relativeUrl;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to generate narration audio for video {VideoId}", videoId);
            return null;
        }
    }
}

