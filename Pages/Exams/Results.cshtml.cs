using AiTeacher.Models;
using AiTeacher.Services.Attempts;
using AiTeacher.Services.Exams;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Exams;

public class ResultsModel : PageModel
{
    private readonly IAttemptStore _attempts;
    private readonly IExamRepository _exams;

    public ResultsModel(IAttemptStore attempts, IExamRepository exams)
    {
        _attempts = attempts;
        _exams = exams;
    }

    public ExamAttempt? Attempt { get; private set; }
    public Exam? Exam { get; private set; }

    public int TotalCount { get; private set; }
    public int CorrectCount { get; private set; }
    public int PercentCorrect { get; private set; }

    public List<QuestionReview> Review { get; private set; } = new();

    public async Task<IActionResult> OnGetAsync(Guid attemptId, CancellationToken ct)
    {
        if (!_attempts.TryGetAttempt(attemptId, out var attempt))
            return Page();

        var exam = await _exams.GetByIdAsync(attempt.ExamId, ct);
        if (exam is null)
            return Page();

        Attempt = attempt;
        Exam = exam;

        TotalCount = exam.Questions.Count;
        CorrectCount = exam.Questions.Count(q =>
            attempt.Answers.TryGetValue(q.Id, out var chosen) && chosen == q.CorrectChoiceIndex);

        PercentCorrect = TotalCount == 0 ? 0 : (int)Math.Round(100.0 * CorrectCount / TotalCount);

        Review = exam.Questions.Select(q =>
        {
            attempt.Answers.TryGetValue(q.Id, out var studentChoiceIndex);
            _attempts.TryGetExplanation(attempt.Id, q.Id, out var cached);

            return new QuestionReview
            {
                QuestionId = q.Id,
                Section = q.Section,
                Prompt = q.Prompt,
                Choices = q.Choices,
                CorrectChoiceIndex = q.CorrectChoiceIndex,
                StudentChoiceIndex = attempt.Answers.ContainsKey(q.Id) ? studentChoiceIndex : null,
                IsCorrect = attempt.Answers.ContainsKey(q.Id) && studentChoiceIndex == q.CorrectChoiceIndex,
                CachedExplanation = cached
            };
        }).ToList();

        return Page();
    }

    public sealed class QuestionReview
    {
        public Guid QuestionId { get; set; }
        public SatSection Section { get; set; }
        public string Prompt { get; set; } = "";
        public List<string> Choices { get; set; } = new();
        public int CorrectChoiceIndex { get; set; }
        public int? StudentChoiceIndex { get; set; }
        public bool IsCorrect { get; set; }
        public string CachedExplanation { get; set; } = "";
    }
}

