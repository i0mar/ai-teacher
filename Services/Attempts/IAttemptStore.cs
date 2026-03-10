namespace AiTeacher.Services.Attempts;

public interface IAttemptStore
{
    Guid CreateAttempt(Guid examId, Dictionary<Guid, int> answers);
    bool TryGetAttempt(Guid attemptId, out ExamAttempt attempt);

    bool TryGetExplanation(Guid attemptId, Guid questionId, out string explanation);
    void SetExplanation(Guid attemptId, Guid questionId, string explanation);

    bool TryGetBoardLines(Guid attemptId, Guid questionId, out string[] boardLines);
    void SetBoardLines(Guid attemptId, Guid questionId, string[] boardLines);

    bool TryGetBoardTimings(Guid attemptId, Guid questionId, out double[] boardTimings);
    void SetBoardTimings(Guid attemptId, Guid questionId, double[] boardTimings);

    bool TryGetBoardTimestampSeconds(Guid attemptId, Guid questionId, out double[] boardTimestampSeconds);
    void SetBoardTimestampSeconds(Guid attemptId, Guid questionId, double[] boardTimestampSeconds);
}
