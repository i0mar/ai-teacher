namespace AiTeacher.Models;

public sealed class VideoJob
{
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public string SourceType { get; set; } = "Lesson";
    public string Script { get; set; } = "";
    public List<string> BoardLines { get; set; } = new();
    public List<double> BoardTimings { get; set; } = new();
    public string? AvatarUrl { get; set; }
    public string? AudioUrl { get; set; }
    public string? VideoUrl { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
}
