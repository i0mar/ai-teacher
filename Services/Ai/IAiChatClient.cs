namespace AiTeacher.Services.Ai;

public interface IAiChatClient
{
    Task<string> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken ct);
}

