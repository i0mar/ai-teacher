namespace AiTeacher.Services.Ai;

public sealed class StubAiImageClient : IAiImageClient
{
    public Task<byte[]?> GeneratePngAsync(string prompt, CancellationToken ct) =>
        Task.FromResult<byte[]?>(null);
}

