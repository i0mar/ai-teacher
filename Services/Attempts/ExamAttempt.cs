using System.Collections.Concurrent;

namespace AiTeacher.Services.Attempts;

public sealed class ExamAttempt
{
    public Guid Id { get; init; }
    public Guid ExamId { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public Dictionary<Guid, int> Answers { get; init; } = new();
    public ConcurrentDictionary<Guid, string> Explanations { get; } = new();
    public ConcurrentDictionary<Guid, string[]> BoardLines { get; } = new();
    public ConcurrentDictionary<Guid, double[]> BoardTimings { get; } = new();
}
