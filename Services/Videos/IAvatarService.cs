namespace AiTeacher.Services.Videos;

public interface IAvatarService
{
    Task<string?> EnsureTeacherAvatarAsync(CancellationToken ct);
}

