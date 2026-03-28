namespace AiTeacher.Models;

public sealed record VideoQuestionBoardRequest(string? WrittenContent, List<string>? DrawCommands);

public sealed record VideoQuestionRequest(string? Question, double? Progress, VideoQuestionBoardRequest? Board);
