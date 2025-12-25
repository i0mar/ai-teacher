using System.Text.Json;
using System.Text.Json.Serialization;
using AiTeacher.Models;
using AiTeacher.Services.Storage;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Exams;

public sealed class JsonExamRepository : IExamRepository
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        Converters =
        {
            new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)
        }
    };

    private readonly IWebHostEnvironment _environment;
    private readonly StorageOptions _storage;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    public JsonExamRepository(IWebHostEnvironment environment, IOptions<StorageOptions> storage)
    {
        _environment = environment;
        _storage = storage.Value;
    }

    public async Task<IReadOnlyList<Exam>> GetAllAsync(CancellationToken ct)
    {
        var seed = await ReadSeedAsync(ct);
        var generated = await ReadGeneratedAsync(ct);

        var combined = seed.Concat(generated)
            .OrderByDescending(e => e.CreatedAtUtc)
            .ToList();

        return combined;
    }

    public async Task<Exam?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        var seed = await ReadSeedAsync(ct);
        var fromSeed = seed.FirstOrDefault(e => e.Id == id);
        if (fromSeed is not null)
            return fromSeed;

        var generated = await ReadGeneratedAsync(ct);
        return generated.FirstOrDefault(e => e.Id == id);
    }

    public async Task SaveGeneratedAsync(Exam exam, CancellationToken ct)
    {
        if (exam.Id == Guid.Empty)
            throw new ArgumentException("Exam id must be set.", nameof(exam));

        exam.IsGenerated = true;
        if (exam.CreatedAtUtc == default)
            exam.CreatedAtUtc = DateTimeOffset.UtcNow;

        await _mutex.WaitAsync(ct);
        try
        {
            var generated = await ReadGeneratedUnsafeAsync(ct);
            var index = generated.FindIndex(e => e.Id == exam.Id);
            if (index >= 0)
                generated[index] = exam;
            else
                generated.Add(exam);

            var path = GetGeneratedPath();
            EnsureParentDirectoryExists(path);

            var json = JsonSerializer.Serialize(generated, SerializerOptions);
            await File.WriteAllTextAsync(path, json, ct);
        }
        finally
        {
            _mutex.Release();
        }
    }

    private async Task<List<Exam>> ReadSeedAsync(CancellationToken ct)
    {
        var path = Path.Combine(_environment.ContentRootPath, "Data", "exams.seed.json");
        if (!File.Exists(path))
            return new List<Exam>();

        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<List<Exam>>(json, SerializerOptions) ?? new List<Exam>();
    }

    private async Task<List<Exam>> ReadGeneratedAsync(CancellationToken ct)
    {
        await _mutex.WaitAsync(ct);
        try
        {
            return await ReadGeneratedUnsafeAsync(ct);
        }
        finally
        {
            _mutex.Release();
        }
    }

    private async Task<List<Exam>> ReadGeneratedUnsafeAsync(CancellationToken ct)
    {
        var path = GetGeneratedPath();
        if (!File.Exists(path))
            return new List<Exam>();

        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<List<Exam>>(json, SerializerOptions) ?? new List<Exam>();
    }

    private string GetGeneratedPath() => Path.Combine(_environment.ContentRootPath, _storage.GeneratedExamsPath);

    private static void EnsureParentDirectoryExists(string filePath)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (string.IsNullOrWhiteSpace(directory))
            return;
        Directory.CreateDirectory(directory);
    }
}

