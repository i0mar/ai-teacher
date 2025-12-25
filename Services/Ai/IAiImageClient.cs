namespace AiTeacher.Services.Ai;

public interface IAiImageClient
{
    Task<byte[]?> GeneratePngAsync(string prompt, CancellationToken ct);
}

