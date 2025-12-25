using AiTeacher.Models;
using AiTeacher.Services.Attempts;
using AiTeacher.Services.Exams;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Exams;

public class TakeModel : PageModel
{
    private readonly IExamRepository _exams;
    private readonly IAttemptStore _attempts;

    public TakeModel(IExamRepository exams, IAttemptStore attempts)
    {
        _exams = exams;
        _attempts = attempts;
    }

    public Exam? Exam { get; private set; }

    public async Task<IActionResult> OnGetAsync(Guid id, CancellationToken ct)
    {
        Exam = await _exams.GetByIdAsync(id, ct);
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(Guid id, CancellationToken ct)
    {
        Exam = await _exams.GetByIdAsync(id, ct);
        if (Exam is null)
            return NotFound();

        var answers = new Dictionary<Guid, int>();
        foreach (var question in Exam.Questions)
        {
            var key = $"answer_{question.Id}";
            if (!Request.Form.TryGetValue(key, out var value))
                continue;

            if (int.TryParse(value.ToString(), out var choiceIndex))
                answers[question.Id] = choiceIndex;
        }

        var attemptId = _attempts.CreateAttempt(Exam.Id, answers);
        return RedirectToPage("/Exams/Results", new { attemptId });
    }
}

