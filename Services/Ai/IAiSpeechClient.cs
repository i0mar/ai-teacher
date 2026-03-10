namespace AiTeacher.Services.Ai;

public interface IAiSpeechClient
{
    Task<byte[]?> SynthesizeWavAsync(string text, CancellationToken ct);
    Task<IReadOnlyList<AiSpeechWordTiming>> TryTranscribeWordTimingsAsync(byte[] audioBytes, string? prompt, CancellationToken ct);
}
