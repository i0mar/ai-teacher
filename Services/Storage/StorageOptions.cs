namespace AiTeacher.Services.Storage;

public sealed class StorageOptions
{
    public string GeneratedExamsPath { get; set; } = "App_Data/exams.generated.json";
    public string VideoJobsPath { get; set; } = "App_Data/videos.json";
}

