using AiTeacher.Models;
using AiTeacher.Services.Videos;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Videos;

public class IndexModel : PageModel
{
    private readonly IVideoJobRepository _videos;

    public IndexModel(IVideoJobRepository videos)
    {
        _videos = videos;
    }

    public IReadOnlyList<VideoJob> Videos { get; private set; } = Array.Empty<VideoJob>();

    public async Task OnGetAsync(CancellationToken ct)
    {
        Videos = await _videos.GetAllAsync(ct);
    }
}

