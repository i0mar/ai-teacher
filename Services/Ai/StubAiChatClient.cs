namespace AiTeacher.Services.Ai;

public sealed class StubAiChatClient : IAiChatClient
{
    public Task<string> CompleteAsync(string systemPrompt, string userPrompt, CancellationToken ct)
    {
        var text =
            "AI is not configured yet.\n\n" +
            "Set Ai__OpenAi__ApiKey or OPENAI_API_KEY to enable live explanations and lesson generation.";

        return Task.FromResult(text);
    }
}
