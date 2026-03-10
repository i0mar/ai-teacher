using System.Text.Json;
using System.Text.RegularExpressions;
using AiTeacher.Models;

namespace AiTeacher.Services.Ai;

public sealed class RealtimeWhiteboardCoordinator
{
    private static readonly Regex BulletPrefixRegex = new(
        @"^\s*(?:[-*•]|\d+[.)])\s+",
        RegexOptions.Compiled);

    private readonly IAiChatClient _ai;
    private readonly ILogger<RealtimeWhiteboardCoordinator> _logger;

    public RealtimeWhiteboardCoordinator(
        IAiChatClient ai,
        ILogger<RealtimeWhiteboardCoordinator> logger)
    {
        _ai = ai;
        _logger = logger;
    }

    public async Task<IReadOnlyList<string>> BuildBoardUpdatesAsync(RealtimeBoardSyncRequest request, CancellationToken ct)
    {
        var topic = SanitizeInline(request.Topic, 140);
        var spokenChunk = SanitizeChunk(request.AssistantTranscriptChunk, 1200);
        var spokenSoFar = SanitizeChunk(request.AssistantTranscriptSoFar, 2400);
        var recentConversation = SanitizeLines(request.RecentConversation, 8, 220);
        var boardLines = SanitizeLines(request.BoardLines, 28, 120);
        var allowDestructiveEdits = HasExplicitStudentBoardEditRequest(recentConversation);

        if (string.IsNullOrWhiteSpace(spokenChunk))
            return Array.Empty<string>();

        var systemPrompt =
            "You are the live whiteboard coordinator for a voice SAT tutor.\n" +
            "Your job is to update the board so it matches what the tutor has ALREADY said out loud.\n" +
            "Never plan ahead. Never solve future steps early. Never dump a full worked example unless the spoken chunk already covered it.\n" +
            "The board is incremental, so assume the current board snapshot remains visible.\n" +
            "If the student asked to write, draw, erase, relabel, move, or clear something, reflect that request when the spoken chunk confirms it.\n" +
            "Return plain text only, one board line per line.\n" +
            "If nothing visible should change yet, return exactly [noop].\n" +
            "\n" +
            "Allowed board line types:\n" +
            "- Plain text whiteboard lines\n" +
            "- DRAW: ... commands compatible with the lesson player\n" +
            "- [clear] to clear the whole board\n" +
            "- [replace-last] <text> to revise only the latest board line\n" +
            "- [pop] to remove only the latest board line\n" +
            "\n" +
            "Supported DRAW examples:\n" +
            "- DRAW: axes x=-5..5 y=-5..5\n" +
            "- DRAW: line y=2x+1\n" +
            "- DRAW: point (3,7) label=(3,7)\n" +
            "- DRAW: focus (3,7)\n" +
            "- DRAW: bar Old=50 New=60\n" +
            "- DRAW: focus bar New\n" +
            "- DRAW: triangle right 3 4 5\n" +
            "- DRAW: focus hyp\n" +
            "- DRAW: circle id=c1 center=(0,0) r=3\n" +
            "- DRAW: square id=s1 center=(2,2) size=2 angle=20\n" +
            "- DRAW: move id=s1 x=1 y=2\n" +
            "- DRAW: clear\n" +
            "\n" +
            "Strict rules:\n" +
            "- Do not narrate.\n" +
            "- Do not address the student.\n" +
            "- Do not use markdown, bullets, numbering, or explanations.\n" +
            "- Do not repeat unchanged existing board lines.\n" +
            "- For a normal spoken chunk, add every new visible equation, label, algebra step, or diagram detail the tutor just said, usually 1 to 3 lines.\n" +
            "- Keep the new board lines in the same order the tutor said them.\n" +
            "- Never clear, pop, replace, or remove board content unless the STUDENT explicitly asked for that kind of board edit.\n" +
            "- By default, keep all prior board work visible and only add new lines.\n" +
            "- Only use [clear], [replace-last], [pop], or DRAW: clear when the student explicitly asked to erase, clear, remove, replace, restart, or wipe the board.\n" +
            "- Never output DRAW: followed by prose. A DRAW line must be a concrete supported command.\n" +
            "- Use DRAW lines only when the spoken chunk explicitly mentions a graph, point, bar, shape, focus, axis, or movement.\n" +
            "- If the tutor says 'write' or states an equation/formula/label, put that exact math or label on the board.\n" +
            "- If the tutor speaks multiple sequential algebra steps that should stay visible, output each step as its own board line instead of compressing them.\n" +
            "- Only output what is justified by the spoken chunk and board context.";

        var userPrompt =
            $"Lesson topic: {topic}\n" +
            $"Is final chunk for this tutor turn: {(request.IsFinalChunk ? "yes" : "no")}\n\n" +
            "Recent conversation:\n" +
            JoinOrFallback(recentConversation, "[no recent conversation]") + "\n\n" +
            "Current whiteboard snapshot:\n" +
            JoinOrFallback(boardLines, "[board is currently blank]") + "\n\n" +
            "Tutor spoken chunk to mirror now:\n" +
            spokenChunk + "\n\n" +
            "Tutor response so far (context only, do not plan ahead from likely future steps):\n" +
            (string.IsNullOrWhiteSpace(spokenSoFar) ? spokenChunk : spokenSoFar);

        try
        {
            var raw = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
            return ParseBoardLines(raw, allowDestructiveEdits);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Realtime whiteboard coordinator failed for topic {Topic}.", topic);
            throw;
        }
    }

    private static IReadOnlyList<string> ParseBoardLines(string raw, bool allowDestructiveEdits)
    {
        var text = (raw ?? "").Trim();
        if (string.IsNullOrWhiteSpace(text))
            return Array.Empty<string>();

        if (text.Equals("[noop]", StringComparison.OrdinalIgnoreCase)
            || text.Equals("noop", StringComparison.OrdinalIgnoreCase))
        {
            return Array.Empty<string>();
        }

        if (text.StartsWith("[", StringComparison.Ordinal))
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<string[]>(text);
                if (parsed is { Length: > 0 })
                    return FilterBoardLines(SanitizeLines(parsed, 8, 120), allowDestructiveEdits);
            }
            catch
            {
                // Fall back to line parsing below.
            }
        }

        var lines = new List<string>();
        foreach (var rawLine in text.Replace("\r", "").Split('\n'))
        {
            var line = SanitizeModelLine(rawLine);
            if (string.IsNullOrWhiteSpace(line))
                continue;

            if (line.Equals("[noop]", StringComparison.OrdinalIgnoreCase)
                || line.Equals("noop", StringComparison.OrdinalIgnoreCase))
            {
                return Array.Empty<string>();
            }

            lines.Add(line);
            if (lines.Count >= 8)
                break;
        }

        return FilterBoardLines(lines, allowDestructiveEdits);
    }

    private static string SanitizeModelLine(string rawLine)
    {
        var line = (rawLine ?? "").Trim();
        if (string.IsNullOrWhiteSpace(line))
            return "";

        if (line.StartsWith("```", StringComparison.Ordinal))
            return "";

        line = BulletPrefixRegex.Replace(line, "");

        if (line.StartsWith("whiteboard:", StringComparison.OrdinalIgnoreCase))
            line = line["whiteboard:".Length..].Trim();
        if (line.StartsWith("line:", StringComparison.OrdinalIgnoreCase))
            line = line["line:".Length..].Trim();
        if (line.StartsWith("lines:", StringComparison.OrdinalIgnoreCase))
            return "";

        if (line.Length >= 2 && line[0] == '"' && line[^1] == '"')
            line = line[1..^1].Trim();

        if (line.StartsWith("DRAW:", StringComparison.OrdinalIgnoreCase))
            line = NormalizeDrawLine(line);

        return line.Length > 120 ? line[..120].TrimEnd() : line;
    }

    private static string NormalizeDrawLine(string line)
    {
        var command = line["DRAW:".Length..].Trim();
        if (string.IsNullOrWhiteSpace(command))
            return "";

        var lower = command.ToLowerInvariant();
        if ((lower == "graph" || lower == "plot" || lower == "sketch" || lower == "draw a graph" || lower == "graph it")
            && !lower.Contains("y=")
            && !lower.Contains("x="))
        {
            return "DRAW: axes x=-5..5 y=-5..5";
        }

        if (lower == "line" || lower == "draw a line")
            return "DRAW: line y=x";

        if ((lower == "triangle" || lower == "draw a triangle" || lower == "right triangle"))
            return "DRAW: triangle right 3 4 5";

        if ((lower == "circle" || lower == "draw a circle"))
            return "DRAW: circle id=c1 center=(0,0) r=3";

        if (lower == "bar" || lower == "bars" || lower == "draw a bar chart")
            return "DRAW: bar A=2 B=5 C=3";

        return $"DRAW: {command}";
    }

    private static IReadOnlyList<string> FilterBoardLines(IEnumerable<string> lines, bool allowDestructiveEdits)
    {
        if (allowDestructiveEdits)
            return lines.ToArray();

        return lines
            .Where(line =>
            {
                var normalized = (line ?? "").Trim();
                if (string.IsNullOrWhiteSpace(normalized))
                    return false;

                if (normalized.Equals("[clear]", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (normalized.Equals("[pop]", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (normalized.StartsWith("[replace-last]", StringComparison.OrdinalIgnoreCase))
                    return false;
                if (normalized.Equals("DRAW: clear", StringComparison.OrdinalIgnoreCase))
                    return false;

                return true;
            })
            .ToArray();
    }

    private static string[] SanitizeLines(IEnumerable<string>? lines, int maxCount, int maxLength)
    {
        if (lines is null)
            return Array.Empty<string>();

        return lines
            .Select(line => SanitizeInline(line, maxLength))
            .Where(line => !string.IsNullOrWhiteSpace(line))
            .Take(maxCount)
            .ToArray();
    }

    private static string SanitizeInline(string? value, int maxLength)
    {
        var text = (value ?? "").Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (text.Length > maxLength)
            text = text[..maxLength].TrimEnd();
        return text;
    }

    private static string SanitizeChunk(string? value, int maxLength)
    {
        var text = (value ?? "").Replace('\r', ' ').Trim();
        text = Regex.Replace(text, @"\s+", " ");
        if (text.Length > maxLength)
            text = text[..maxLength].TrimEnd();
        return text;
    }

    private static string JoinOrFallback(IEnumerable<string> lines, string fallback)
    {
        var array = lines.ToArray();
        if (array.Length == 0)
            return fallback;

        return string.Join("\n", array.Select((line, index) => $"{index + 1}. {line}"));
    }

    private static bool HasExplicitStudentBoardEditRequest(IEnumerable<string> recentConversation)
    {
        foreach (var line in recentConversation)
        {
            var text = (line ?? "").Trim();
            if (!text.StartsWith("Student:", StringComparison.OrdinalIgnoreCase))
                continue;

            var lower = text.ToLowerInvariant();
            if (lower.Contains("clear")
                || lower.Contains("erase")
                || lower.Contains("remove")
                || lower.Contains("delete")
                || lower.Contains("replace")
                || lower.Contains("wipe")
                || lower.Contains("reset")
                || lower.Contains("start over"))
            {
                return true;
            }
        }

        return false;
    }
}
