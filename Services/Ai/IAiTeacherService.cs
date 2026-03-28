using AiTeacher.Models;

namespace AiTeacher.Services.Ai;

public interface IAiTeacherService
{
    Task<string> GenerateLessonScriptAsync(string topic, LessonLength length, CancellationToken ct);
    Task<AiVideoPack> GenerateLessonVideoAsync(string topic, LessonLength length, CancellationToken ct);
    Task<string> ExplainQuestionAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct);
    Task<AiVideoPack> ExplainQuestionVideoAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct);
    Task<AiVideoPack> AnswerVideoQuestionAsync(VideoJob video, string question, double? progress, VideoQuestionBoardRequest? board, CancellationToken ct);
    Task<Exam> GenerateMiniExamAsync(string section, int questionCount, CancellationToken ct);
}
