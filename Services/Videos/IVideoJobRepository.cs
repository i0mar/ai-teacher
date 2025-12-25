using AiTeacher.Models;

namespace AiTeacher.Services.Videos;

public interface IVideoJobRepository
{
    Task<IReadOnlyList<VideoJob>> GetAllAsync(CancellationToken ct);
    Task<VideoJob?> GetByIdAsync(Guid id, CancellationToken ct);
    Task CreateAsync(VideoJob job, CancellationToken ct);
    Task UpdateAsync(VideoJob job, CancellationToken ct);
}
