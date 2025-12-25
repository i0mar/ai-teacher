using AiTeacher.Models;
using AiTeacher.Services.Videos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Videos;

public class WatchModel : PageModel
{
    private readonly IVideoJobRepository _videos;
    private readonly IAvatarService _avatars;

    public WatchModel(IVideoJobRepository videos, IAvatarService avatars)
    {
        _videos = videos;
        _avatars = avatars;
    }

    public VideoJob? Video { get; private set; }

    public async Task<IActionResult> OnGetAsync(Guid id, CancellationToken ct)
    {
        Video = await _videos.GetByIdAsync(id, ct);
        if (Video is not null && ShouldRefreshAvatar(Video.AvatarUrl))
        {
            Video.AvatarUrl = await _avatars.EnsureTeacherAvatarAsync(ct);
            await _videos.UpdateAsync(Video, ct);
        }
        return Page();
    }

    private static bool ShouldRefreshAvatar(string? avatarUrl)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl))
            return true;

        // Migrate older avatar assets to the newer photorealistic, gesture-friendly avatar.
        return avatarUrl.EndsWith("/teacher.png", StringComparison.OrdinalIgnoreCase)
            || avatarUrl.EndsWith("/teacher.svg", StringComparison.OrdinalIgnoreCase)
            || avatarUrl.EndsWith("/teacher-human.png", StringComparison.OrdinalIgnoreCase)
            || avatarUrl.EndsWith("/teacher-human.svg", StringComparison.OrdinalIgnoreCase);
    }
}
