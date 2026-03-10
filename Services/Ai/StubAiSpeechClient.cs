namespace AiTeacher.Services.Ai;

public sealed class StubAiSpeechClient : IAiSpeechClient
{
    public Task<byte[]?> SynthesizeWavAsync(string text, CancellationToken ct) =>
        Task.FromResult<byte[]?>(null);

    public Task<IReadOnlyList<AiSpeechWordTiming>> TryTranscribeWordTimingsAsync(byte[] audioBytes, string? prompt, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<AiSpeechWordTiming>>(Array.Empty<AiSpeechWordTiming>());
}
