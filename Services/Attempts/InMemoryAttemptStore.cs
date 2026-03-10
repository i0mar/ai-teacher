using System.Collections.Concurrent;

namespace AiTeacher.Services.Attempts;

public sealed class InMemoryAttemptStore : IAttemptStore
{
    private readonly ConcurrentDictionary<Guid, ExamAttempt> _attempts = new();
    private static readonly TimeSpan AttemptTtl = TimeSpan.FromHours(12);

    public Guid CreateAttempt(Guid examId, Dictionary<Guid, int> answers)
    {
        Cleanup();

        var attempt = new ExamAttempt
        {
            Id = Guid.NewGuid(),
            ExamId = examId,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Answers = answers
        };

        _attempts[attempt.Id] = attempt;
        return attempt.Id;
    }

    public bool TryGetAttempt(Guid attemptId, out ExamAttempt attempt) => _attempts.TryGetValue(attemptId, out attempt!);

    public bool TryGetExplanation(Guid attemptId, Guid questionId, out string explanation)
    {
        explanation = "";
        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return false;

        return attempt.Explanations.TryGetValue(questionId, out explanation!);
    }

    public void SetExplanation(Guid attemptId, Guid questionId, string explanation)
    {
        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return;

        attempt.Explanations[questionId] = explanation;
    }

    public bool TryGetBoardLines(Guid attemptId, Guid questionId, out string[] boardLines)
    {
        boardLines = Array.Empty<string>();
        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return false;

        return attempt.BoardLines.TryGetValue(questionId, out boardLines!);
    }

    public void SetBoardLines(Guid attemptId, Guid questionId, string[] boardLines)
    {
        if (boardLines is null || boardLines.Length == 0)
            return;

        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return;

        attempt.BoardLines[questionId] = boardLines;
    }

    public bool TryGetBoardTimings(Guid attemptId, Guid questionId, out double[] boardTimings)
    {
        boardTimings = Array.Empty<double>();
        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return false;

        return attempt.BoardTimings.TryGetValue(questionId, out boardTimings!);
    }

    public void SetBoardTimings(Guid attemptId, Guid questionId, double[] boardTimings)
    {
        if (boardTimings is null || boardTimings.Length == 0)
            return;

        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return;

        attempt.BoardTimings[questionId] = boardTimings;
    }

    public bool TryGetBoardTimestampSeconds(Guid attemptId, Guid questionId, out double[] boardTimestampSeconds)
    {
        boardTimestampSeconds = Array.Empty<double>();
        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return false;

        return attempt.BoardTimestampSeconds.TryGetValue(questionId, out boardTimestampSeconds!);
    }

    public void SetBoardTimestampSeconds(Guid attemptId, Guid questionId, double[] boardTimestampSeconds)
    {
        if (boardTimestampSeconds is null || boardTimestampSeconds.Length == 0)
            return;

        if (!_attempts.TryGetValue(attemptId, out var attempt))
            return;

        attempt.BoardTimestampSeconds[questionId] = boardTimestampSeconds;
    }

    private void Cleanup()
    {
        var cutoff = DateTimeOffset.UtcNow - AttemptTtl;
        foreach (var (id, attempt) in _attempts)
        {
            if (attempt.CreatedAtUtc < cutoff)
                _attempts.TryRemove(id, out _);
        }
    }
}
