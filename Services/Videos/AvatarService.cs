using AiTeacher.Services.Ai;

namespace AiTeacher.Services.Videos;

public sealed class AvatarService : IAvatarService
{
    private readonly IWebHostEnvironment _env;
    private readonly IAiImageClient _images;
    private readonly ILogger<AvatarService> _logger;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    public AvatarService(IWebHostEnvironment env, IAiImageClient images, ILogger<AvatarService> logger)
    {
        _env = env;
        _images = images;
        _logger = logger;
    }

    public async Task<string?> EnsureTeacherAvatarAsync(CancellationToken ct)
    {
        var webRoot = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(webRoot))
            webRoot = Path.Combine(_env.ContentRootPath, "wwwroot");

        // Versioned filename so we can evolve the prompt without breaking old videos.
        var pngPath = Path.Combine(webRoot, "generated", "avatars", "teacher-human-v2.png");
        var svgPath = Path.Combine(webRoot, "generated", "avatars", "teacher-human-v2.svg");

        if (File.Exists(pngPath))
            return "/generated/avatars/teacher-human-v2.png";

        if (File.Exists(svgPath))
            return "/generated/avatars/teacher-human-v2.svg";

        await _mutex.WaitAsync(ct);
        try
        {
            if (File.Exists(pngPath))
                return "/generated/avatars/teacher-human-v2.png";

            if (File.Exists(svgPath))
                return "/generated/avatars/teacher-human-v2.svg";

            Directory.CreateDirectory(Path.GetDirectoryName(pngPath)!);

            var prompt =
                "Create a photorealistic portrait photo of a fictional SAT teacher.\n" +
                "Style: photorealistic, studio lighting, DSLR look, shallow depth of field.\n" +
                "Framing: waist-up (upper body visible), front-facing, centered, looking at camera.\n" +
                "Pose: natural teaching body language (one hand gesturing), relaxed posture.\n" +
                "Appearance: friendly adult teacher, professional attire (blazer or sweater), warm smile.\n" +
                "Background: solid light gray.\n" +
                "Important: this must be a completely fictional person and MUST NOT resemble any real individual.\n" +
                "No text, no logos, no watermark.";

            try
            {
                var png = await _images.GeneratePngAsync(prompt, ct);
                if (png is not null && png.Length > 0)
                {
                    await File.WriteAllBytesAsync(pngPath, png, ct);
                    return "/generated/avatars/teacher-human-v2.png";
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Avatar image generation failed; using local placeholder.");
            }

            var svg = LocalPlaceholderSvg();
            Directory.CreateDirectory(Path.GetDirectoryName(svgPath)!);
            await File.WriteAllTextAsync(svgPath, svg, ct);
            return "/generated/avatars/teacher-human-v2.svg";
        }
        finally
        {
            _mutex.Release();
        }
    }

    private static string LocalPlaceholderSvg() =>
        """
        <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
          <defs>
            <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#111827"/>
              <stop offset="1" stop-color="#1f2937"/>
            </linearGradient>
          </defs>
          <rect width="1024" height="1024" fill="url(#bg)"/>
          <circle cx="512" cy="420" r="210" fill="#f5d0c5"/>
          <path d="M 300 760 C 360 640 420 600 512 600 C 604 600 664 640 724 760 L 724 900 L 300 900 Z" fill="#7c3aed" opacity="0.9"/>
          <circle cx="440" cy="390" r="18" fill="#111827"/>
          <circle cx="584" cy="390" r="18" fill="#111827"/>
          <path d="M 430 470 C 470 520 554 520 594 470" stroke="#111827" stroke-width="18" stroke-linecap="round" fill="none"/>
          <path d="M 350 340 C 430 260 594 260 674 340" stroke="#111827" stroke-width="22" stroke-linecap="round" fill="none" opacity="0.35"/>
          <text x="512" y="980" font-size="42" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial">Teacher Avatar</text>
        </svg>
        """;
}
