namespace AiTeacher.Models;

public sealed class Exam
{
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public List<Question> Questions { get; set; } = new();
    public bool IsGenerated { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
}
