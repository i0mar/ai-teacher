using AiTeacher.Models;
using AiTeacher.Services.Ai;
using AiTeacher.Services.Exams;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Exams;

public class IndexModel : PageModel
{
    private readonly IExamRepository _exams;
    private readonly IAiTeacherService _ai;

    public IndexModel(IExamRepository exams, IAiTeacherService ai)
    {
        _exams = exams;
        _ai = ai;
    }

    public IReadOnlyList<Exam> Exams { get; private set; } = Array.Empty<Exam>();

    [BindProperty]
    public string Section { get; set; } = "Mixed";

    [BindProperty]
    public int QuestionCount { get; set; } = 10;

    public async Task OnGetAsync(CancellationToken ct)
    {
        Exams = await _exams.GetAllAsync(ct);
    }

    public async Task<IActionResult> OnPostAsync(CancellationToken ct)
    {
        var exam = await _ai.GenerateMiniExamAsync(Section, QuestionCount, ct);
        await _exams.SaveGeneratedAsync(exam, ct);
        return RedirectToPage("/Exams/Take", new { id = exam.Id });
    }
}

