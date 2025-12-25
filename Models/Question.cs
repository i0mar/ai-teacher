namespace AiTeacher.Models;

public sealed class Question
{
    public Guid Id { get; set; }
    public SatSection Section { get; set; }
    public string Prompt { get; set; } = "";
    public List<string> Choices { get; set; } = new();
    public int CorrectChoiceIndex { get; set; }
    public string Explanation { get; set; } = "";
}

