namespace AiTeacher.Services.Videos;

public sealed record VideoNarrationResult(
    string? AudioUrl,
    IReadOnlyList<double> BoardTimestampSeconds,
    IReadOnlyList<string> NarrationSegments);
