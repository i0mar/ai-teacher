using AiTeacher.Models;
using AiTeacher.Services.Videos;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Videos;

public class WatchModel : PageModel
{
    private readonly IVideoJobRepository _videos;

    public WatchModel(IVideoJobRepository videos)
    {
        _videos = videos;
    }

    public VideoJob? Video { get; private set; }

    public async Task OnGetAsync(Guid id, CancellationToken ct)
    {
        Video = await _videos.GetByIdAsync(id, ct);
    }
}
