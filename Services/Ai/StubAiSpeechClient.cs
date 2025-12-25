namespace AiTeacher.Services.Ai;

public sealed class StubAiSpeechClient : IAiSpeechClient
{
    public Task<byte[]?> SynthesizeMp3Async(string text, CancellationToken ct) =>
        Task.FromResult<byte[]?>(null);
}

