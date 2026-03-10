namespace AiTeacher.Services.Videos;

public interface IVideoNarrationService
{
    Task<VideoNarrationResult> TryGenerateAudioAsync(
        Guid videoId,
        string script,
        IReadOnlyList<string>? narrationSegments,
        IReadOnlyList<string>? boardLines,
        IReadOnlyList<double>? boardTimings,
        IReadOnlyList<double>? boardTimestampSeconds,
        CancellationToken ct);
}
