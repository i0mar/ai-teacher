using AiTeacher.Models;
using AiTeacher.Services.Ai;
using AiTeacher.Services.Videos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Lessons;

public class IndexModel : PageModel
{
    private readonly IAiTeacherService _aiTeacher;
    private readonly IVideoJobRepository _videos;
    private readonly IVideoNarrationService _narration;
    private readonly IAvatarService _avatars;

    public IndexModel(IAiTeacherService aiTeacher, IVideoJobRepository videos, IVideoNarrationService narration, IAvatarService avatars)
    {
        _aiTeacher = aiTeacher;
        _videos = videos;
        _narration = narration;
        _avatars = avatars;
    }

    [BindProperty]
    public string Topic { get; set; } = "";

    public IReadOnlyList<string> SuggestedTopics { get; } =
    [
        "Solving linear equations",
        "Systems of equations (substitution)",
        "Percent change and unit rates",
        "Right triangles and the Pythagorean theorem",
        "Transitions: however, therefore, nevertheless",
        "Subject–verb agreement",
        "Conciseness and redundancy",
        "Interpreting graphs and tables"
    ];

    public void OnGet()
    {
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(Topic))
        {
            ModelState.AddModelError(nameof(Topic), "Enter a lesson topic.");
            return Page();
        }

        var pack = await _aiTeacher.GenerateLessonVideoAsync(Topic.Trim(), ct);
        var job = new VideoJob
        {
            Id = Guid.NewGuid(),
            Title = $"Lesson: {Topic.Trim()}",
            SourceType = "Lesson",
            Script = pack.Narration,
            BoardLines = pack.BoardLines,
            BoardTimings = pack.BoardTimings,
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

        job.AvatarUrl = await _avatars.EnsureTeacherAvatarAsync(ct);
        job.AudioUrl = await _narration.TryGenerateAudioAsync(job.Id, job.Script, ct);
        await _videos.CreateAsync(job, ct);
        return RedirectToPage("/Videos/Watch", new { id = job.Id });
    }
}
