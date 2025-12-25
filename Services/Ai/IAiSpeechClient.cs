namespace AiTeacher.Services.Ai;

public interface IAiSpeechClient
{
    Task<byte[]?> SynthesizeMp3Async(string text, CancellationToken ct);
}

