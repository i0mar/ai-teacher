using AiTeacher.Models;

namespace AiTeacher.Services.Ai;

public interface IAiTeacherService
{
    Task<string> GenerateLessonScriptAsync(string topic, CancellationToken ct);
    Task<AiVideoPack> GenerateLessonVideoAsync(string topic, CancellationToken ct);
    Task<string> ExplainQuestionAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct);
    Task<AiVideoPack> ExplainQuestionVideoAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct);
    Task<AiVideoPack> AnswerVideoQuestionAsync(VideoJob video, string question, double? progress, CancellationToken ct);
    Task<Exam> GenerateMiniExamAsync(string section, int questionCount, CancellationToken ct);
}
