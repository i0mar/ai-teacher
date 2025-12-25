using AiTeacher.Models;

namespace AiTeacher.Services.Exams;

public interface IExamRepository
{
    Task<IReadOnlyList<Exam>> GetAllAsync(CancellationToken ct);
    Task<Exam?> GetByIdAsync(Guid id, CancellationToken ct);
    Task SaveGeneratedAsync(Exam exam, CancellationToken ct);
}

