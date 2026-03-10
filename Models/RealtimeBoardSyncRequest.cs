namespace AiTeacher.Models;

public sealed record RealtimeBoardSyncRequest(
    string? Topic,
    string? AssistantTranscriptChunk,
    string? AssistantTranscriptSoFar,
    string[]? RecentConversation,
    string[]? BoardLines,
    bool IsFinalChunk);
