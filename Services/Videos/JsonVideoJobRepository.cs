using System.Text.Json;
using AiTeacher.Models;
using AiTeacher.Services.Storage;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Videos;

public sealed class JsonVideoJobRepository : IVideoJobRepository
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly IWebHostEnvironment _environment;
    private readonly StorageOptions _storage;
    private readonly SemaphoreSlim _mutex = new(1, 1);

    public JsonVideoJobRepository(IWebHostEnvironment environment, IOptions<StorageOptions> storage)
    {
        _environment = environment;
        _storage = storage.Value;
    }

    public async Task<IReadOnlyList<VideoJob>> GetAllAsync(CancellationToken ct)
    {
        await _mutex.WaitAsync(ct);
        try
        {
            var all = await ReadUnsafeAsync(ct);
            return all.OrderByDescending(v => v.CreatedAtUtc).ToList();
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task<VideoJob?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        await _mutex.WaitAsync(ct);
        try
        {
            var all = await ReadUnsafeAsync(ct);
            return all.FirstOrDefault(v => v.Id == id);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task CreateAsync(VideoJob job, CancellationToken ct)
    {
        if (job.Id == Guid.Empty)
            throw new ArgumentException("Video job id must be set.", nameof(job));

        await _mutex.WaitAsync(ct);
        try
        {
            var all = await ReadUnsafeAsync(ct);
            all.Add(job);

            var path = GetPath();
            EnsureParentDirectoryExists(path);

            var json = JsonSerializer.Serialize(all, SerializerOptions);
            await File.WriteAllTextAsync(path, json, ct);
        }
        finally
        {
            _mutex.Release();
        }
    }

    public async Task UpdateAsync(VideoJob job, CancellationToken ct)
    {
        if (job.Id == Guid.Empty)
            throw new ArgumentException("Video job id must be set.", nameof(job));

        await _mutex.WaitAsync(ct);
        try
        {
            var all = await ReadUnsafeAsync(ct);
            var index = all.FindIndex(v => v.Id == job.Id);
            if (index < 0)
                throw new InvalidOperationException("Video job not found.");

            all[index] = job;

            var path = GetPath();
            EnsureParentDirectoryExists(path);

            var json = JsonSerializer.Serialize(all, SerializerOptions);
            await File.WriteAllTextAsync(path, json, ct);
        }
        finally
        {
            _mutex.Release();
        }
    }

    private async Task<List<VideoJob>> ReadUnsafeAsync(CancellationToken ct)
    {
        var path = GetPath();
        if (!File.Exists(path))
            return new List<VideoJob>();

        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<List<VideoJob>>(json, SerializerOptions) ?? new List<VideoJob>();
    }

    private string GetPath() => Path.Combine(_environment.ContentRootPath, _storage.VideoJobsPath);

    private static void EnsureParentDirectoryExists(string filePath)
    {
        var directory = Path.GetDirectoryName(filePath);
        if (string.IsNullOrWhiteSpace(directory))
            return;
        Directory.CreateDirectory(directory);
    }
}
