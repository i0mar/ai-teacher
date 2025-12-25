namespace AiTeacher.Services.Videos;

public interface IVideoNarrationService
{
    Task<string?> TryGenerateAudioAsync(Guid videoId, string script, CancellationToken ct);
}

