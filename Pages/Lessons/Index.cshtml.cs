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

    public IndexModel(
        IAiTeacherService aiTeacher,
        IVideoJobRepository videos,
        IVideoNarrationService narration)
    {
        _aiTeacher = aiTeacher;
        _videos = videos;
        _narration = narration;
    }

    [BindProperty]
    public string Topic { get; set; } = "";

    [BindProperty]
    public LessonLength Length { get; set; } = LessonLength.Long;

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

        if (!Enum.IsDefined(Length))
            Length = LessonLength.Long;

        var pack = await _aiTeacher.GenerateLessonVideoAsync(Topic.Trim(), Length, ct);
        var job = new VideoJob
        {
            Id = Guid.NewGuid(),
            Title = Length == LessonLength.Short
                ? $"Lesson (Short): {Topic.Trim()}"
                : $"Lesson: {Topic.Trim()}",
            SourceType = "Lesson",
            Script = pack.Narration,
            NarrationSegments = pack.NarrationSegments ?? new List<string>(),
            BoardLines = pack.BoardLines,
            BoardTimings = pack.BoardTimings,
            BoardTimestampSeconds = pack.BoardTimestampSeconds ?? new List<double>(),
            CreatedAtUtc = DateTimeOffset.UtcNow
        };

        var narrationResult = await _narration.TryGenerateAudioAsync(
            job.Id,
            job.Script,
            job.NarrationSegments,
            job.BoardLines,
            job.BoardTimings,
            job.BoardTimestampSeconds,
            ct);
        job.AudioUrl = narrationResult.AudioUrl;
        if (narrationResult.BoardTimestampSeconds.Count == job.BoardLines.Count)
            job.BoardTimestampSeconds = narrationResult.BoardTimestampSeconds.ToList();
        if (narrationResult.NarrationSegments.Count == job.BoardLines.Count)
            job.NarrationSegments = narrationResult.NarrationSegments.ToList();

        await _videos.CreateAsync(job, ct);
        return RedirectToPage("/Videos/Watch", new { id = job.Id });
    }
}
