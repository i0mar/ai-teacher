using System.Text.Json;
using System.Globalization;
using AiTeacher.Models;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class AiTeacherService : IAiTeacherService
{
    private readonly IAiChatClient _ai;
    private readonly AiOptions _options;

    public AiTeacherService(IAiChatClient ai, IOptions<AiOptions> options)
    {
        _ai = ai;
        _options = options.Value;
    }

    public async Task<string> GenerateLessonScriptAsync(string topic, CancellationToken ct)
    {
        var pack = await GenerateLessonVideoAsync(topic, ct);
        return pack.Narration;
    }

    public async Task<AiVideoPack> GenerateLessonVideoAsync(string topic, CancellationToken ct)
    {
        topic = (topic ?? "").Trim();
        if (string.IsNullOrWhiteSpace(topic))
            return new AiVideoPack("", new List<string>(), new List<double>());

        if (!IsOpenAiEnabled())
        {
            var fallbackNarration =
                $"Today we're learning: {topic}.\n\n" +
                "We'll do this like a real SAT lesson:\n" +
                "1) Quick idea\n" +
                "2) Two examples\n" +
                "3) Mini-quiz\n" +
                "4) Common traps\n\n" +
                "Grab a pencil — I'll write the key steps on the board as we go.";

            var fallbackBoard = CleanBoardLines(new[]
            {
                $"TOPIC: {topic}",
                "Goal: recognize the pattern",
                "Rule: write the key formula",
                "Example 1: set up the equation",
                "Example 1: solve step-by-step",
                "Example 2: same idea, new numbers",
                "Mini-quiz: try it yourself",
                "Trap: watch signs/units",
                "Takeaway: method > memorizing"
            });

            return new AiVideoPack(fallbackNarration, fallbackBoard, EvenTimings(fallbackBoard.Count));
        }

        const string systemPrompt =
            "You are an expert SAT tutor who teaches like a real classroom teacher. " +
            "Write in a friendly spoken voice and include what to write on a whiteboard. " +
            "Avoid referencing copyrighted SAT questions. Return plain text only (no markdown).";

        var userPrompt =
            $"Create a 3–5 minute SAT lesson script on this topic:\n\n{topic}\n\n" +
            "Output format EXACTLY:\n" +
            "NARRATION:\n" +
            "(spoken lesson script)\n\n" +
            "WHITEBOARD:\n" +
            "- (short line 1)\n" +
            "- (short line 2)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "- 0.12\n" +
            "- 0.25\n" +
            "...\n\n" +
            "Requirements:\n" +
            "- Narration: start with a 1-sentence hook, teach with 2 small examples, include a 2-question mini-quiz + answers, end with 3 takeaways + 2 common mistakes.\n" +
            "- Narration should occasionally say things like \"Let's write this\" or \"On the board\".\n" +
            "- Whiteboard: 10–16 short lines, max ~56 characters each, using ASCII math (no LaTeX), showing the steps/formulas you'll write.\n" +
            "- Timings: one number per whiteboard line (same count), strictly increasing, each between 0 and 1.\n" +
            "- Each timing is the approximate moment (as a fraction of the narration) when you want that line to start being written.\n" +
            "- Do NOT start writing a line before the narration reaches that step.\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        return ParseVideoPack(text, fallbackBoardHeader: $"TOPIC: {topic}");
    }

    public async Task<string> ExplainQuestionAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct)
    {
        var pack = await ExplainQuestionVideoAsync(exam, question, studentChoiceIndex, ct);
        return pack.Narration;
    }

    public async Task<AiVideoPack> ExplainQuestionVideoAsync(Exam exam, Question question, int? studentChoiceIndex, CancellationToken ct)
    {
        if (!IsOpenAiEnabled())
        {
            if (!string.IsNullOrWhiteSpace(question.Explanation))
            {
                var board = CleanBoardLines(DeriveBoardLines(question.Explanation));
                return new AiVideoPack(question.Explanation, board, EvenTimings(board.Count));
            }

            const string fallbackNarration = "Explanation unavailable in Stub mode for this question.";
            var fallbackBoard = CleanBoardLines(DeriveBoardLines(fallbackNarration));
            return new AiVideoPack(fallbackNarration, fallbackBoard, EvenTimings(fallbackBoard.Count));
        }

        const string systemPrompt =
            "You are an expert SAT tutor. Explain solutions step-by-step with clear reasoning. " +
            "Teach like a real teacher: say what you'd write on the board. " +
            "Avoid copyrighted SAT content. Return plain text only (no markdown).";

        var studentChoiceText = studentChoiceIndex is null
            ? "Student did not answer."
            : $"Student selected choice index {studentChoiceIndex.Value}.";

        var userPrompt =
            $"Exam: {exam.Title}\n" +
            $"Section: {question.Section}\n\n" +
            $"Question:\n{question.Prompt}\n\n" +
            $"Choices:\n{FormatChoices(question.Choices)}\n\n" +
            $"Correct choice index: {question.CorrectChoiceIndex}\n" +
            $"{studentChoiceText}\n\n" +
            "Output format EXACTLY:\n" +
            "NARRATION:\n" +
            "(spoken explanation)\n\n" +
            "WHITEBOARD:\n" +
            "1) (short line)\n" +
            "2) (short line)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "1) 0.15\n" +
            "2) 0.35\n" +
            "...\n\n" +
            "Requirements:\n" +
            "- Narration: identify the correct answer (A/B/C/D), explain why, step-by-step, and mention common traps.\n" +
            "- Narration should reference writing steps (\"Let's write...\").\n" +
            "- Whiteboard: 6–12 short lines, max ~56 characters each, showing equations/steps.\n" +
            "- Use ASCII math (no LaTeX).\n" +
            "- Timings: one number per whiteboard line (same count), strictly increasing, each between 0 and 1.\n" +
            "- Each timing is the approximate moment (as a fraction of the narration) when you want that line to start being written.\n" +
            "- Keep narration under ~300-450 words.\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        return ParseVideoPack(text, fallbackBoardHeader: "Solution steps:");
    }

    public async Task<AiVideoPack> AnswerVideoQuestionAsync(VideoJob video, string question, double? progress, CancellationToken ct)
    {
        var q = (question ?? "").Trim();
        if (string.IsNullOrWhiteSpace(q))
            return new AiVideoPack("", new List<string>(), new List<double>());

        if (!IsOpenAiEnabled())
        {
            var fallbackNarration =
                "Let's pause the lesson for a second and answer your question.\n\n" +
                "AI isn't configured yet, so I can't generate a real-time answer.\n" +
                "Set Ai__Provider=OpenAI and Ai__OpenAi__ApiKey, then try again.\n\n" +
                "Alright—now let's jump back into the lesson.";

            var header = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";
            var board = CleanBoardLines(new[] { header, "Enable OpenAI to answer." });
            return new AiVideoPack(fallbackNarration, board, EvenTimings(board.Count));
        }

        var clampedProgress = progress is { } p && double.IsFinite(p) ? Math.Clamp(p, 0, 1) : (double?)null;

        var activeIndex = -1;
        var lines = video.BoardLines ?? new List<string>();
        var lessonTimings = video.BoardTimings ?? new List<double>();
        var count = Math.Min(lines.Count, lessonTimings.Count);
        if (clampedProgress is not null && count > 0)
        {
            for (var i = 0; i < count; i++)
            {
                if (clampedProgress.Value >= lessonTimings[i])
                    activeIndex = i;
            }
        }

        var recentLines = new List<string>();
        if (activeIndex >= 0 && lines.Count > 0)
        {
            var start = Math.Max(0, activeIndex - 4);
            for (var i = start; i <= activeIndex && i < lines.Count; i++)
            {
                if (!string.IsNullOrWhiteSpace(lines[i]))
                    recentLines.Add(lines[i].Trim());
            }
        }

        var script = (video.Script ?? "").Trim();
        const int maxContextChars = 2600;
        if (script.Length > maxContextChars)
            script = script.Substring(0, maxContextChars) + "\n\n(Truncated.)";

        const string systemPrompt =
            "You are an expert SAT tutor teaching like a real classroom teacher. " +
            "A student PAUSED the lesson to ask a question, and you will answer it, then smoothly return to the lesson. " +
            "Be friendly, natural, and step-by-step when helpful. " +
            "Use plain text only (no markdown). " +
            "Avoid referencing copyrighted SAT questions.";

        var headerLine = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";

        var userPrompt =
            $"Video title: {video.Title}\n" +
            $"Video type: {video.SourceType}\n" +
            (clampedProgress is null ? "" : $"Paused at: ~{(int)Math.Round(clampedProgress.Value * 100)}% of the lesson\n") +
            (recentLines.Count == 0 ? "" : $"Whiteboard so far (most recent):\n- {string.Join("\n- ", recentLines)}\n") +
            "\nLesson narration (context):\n" +
            (string.IsNullOrWhiteSpace(script) ? "(No script available.)" : script) +
            "\n\nStudent question:\n" +
            q +
            "\n\nOutput format EXACTLY:\n" +
            "NARRATION:\n" +
            "(what you will say out loud)\n\n" +
            "WHITEBOARD:\n" +
            "- (short line 1)\n" +
            "- (short line 2)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "- 0.12\n" +
            "- 0.25\n" +
            "...\n\n" +
            "Requirements:\n" +
            "- Narration MUST start by acknowledging the pause (e.g., \"Great question—let's pause and answer it.\")\n" +
            "- Narration MUST end with returning to the lesson (e.g., \"Alright—now let's jump back into the lesson.\")\n" +
            "- Keep it brief: ~20–60 seconds spoken.\n" +
            $"- Whiteboard: 6–12 short lines, max ~56 characters each. First line MUST be exactly: {headerLine}\n" +
            "- Use ASCII math (no LaTeX).\n" +
            "- Timings: one number per whiteboard line (same count), strictly increasing, each between 0 and 1.\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var pack = ParseVideoPack(text, fallbackBoardHeader: headerLine);

        var narration = (pack.Narration ?? "").Trim();
        if (string.IsNullOrWhiteSpace(narration))
        {
            narration =
                "Great question—let's pause and answer it.\n\n" +
                (text ?? "").Trim() +
                "\n\nAlright—now let's jump back into the lesson.";
        }

        var finalBoard = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var timings = CleanTimings(new List<double>(pack.BoardTimings ?? new List<double>()), finalBoard.Count);

        if (finalBoard.Count == 0)
        {
            finalBoard = CleanBoardLines(DeriveBoardLines(narration));
            timings = EvenTimings(finalBoard.Count);
        }

        if (!string.IsNullOrWhiteSpace(headerLine))
        {
            if (finalBoard.Count == 0 || !string.Equals(finalBoard[0], headerLine, StringComparison.OrdinalIgnoreCase))
            {
                finalBoard.Insert(0, headerLine);
                timings = EvenTimings(finalBoard.Count);
            }
        }

        if (finalBoard.Count > 12)
        {
            finalBoard = finalBoard.Take(12).ToList();
            timings = timings.Take(finalBoard.Count).ToList();
        }

        timings = CleanTimings(timings, finalBoard.Count);
        return new AiVideoPack(narration, finalBoard, timings);
    }

    public async Task<Exam> GenerateMiniExamAsync(string section, int questionCount, CancellationToken ct)
    {
        questionCount = Math.Clamp(questionCount, 5, 30);
        section = (section ?? "Mixed").Trim();

        if (!IsOpenAiEnabled())
            return GenerateLocalExam(section, questionCount);

        const string systemPrompt =
            "You are an expert SAT tutor who writes original, non-copyrighted practice questions. " +
            "Return ONLY valid JSON matching the requested schema. No markdown, no code fences.";

        var userPrompt =
            "Create an original SAT mini practice exam.\n\n" +
            $"Section: {section}\n" +
            $"QuestionCount: {questionCount}\n\n" +
            "Schema (JSON):\n" +
            "{\n" +
            "  \"title\": \"string\",\n" +
            "  \"description\": \"string\",\n" +
            "  \"questions\": [\n" +
            "    {\n" +
            "      \"section\": \"Math\" | \"ReadingWriting\",\n" +
            "      \"prompt\": \"string\",\n" +
            "      \"choices\": [\"A\", \"B\", \"C\", \"D\"],\n" +
            "      \"correctChoiceIndex\": 0-3,\n" +
            "      \"explanation\": \"string\"\n" +
            "    }\n" +
            "  ]\n" +
            "}\n";

        var json = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var extracted = ExtractJsonObject(json) ?? throw new InvalidOperationException("Model did not return valid JSON.");

        var generated = JsonSerializer.Deserialize<GeneratedExamDto>(extracted, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Failed to parse generated exam JSON.");

        var exam = new Exam
        {
            Id = Guid.NewGuid(),
            Title = generated.Title?.Trim().Length > 0 ? generated.Title.Trim() : "Generated SAT Mini Exam",
            Description = generated.Description?.Trim() ?? "",
            IsGenerated = true,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Questions = generated.Questions?.Select(q => new Question
            {
                Id = Guid.NewGuid(),
                Section = Enum.TryParse<SatSection>(q.Section, ignoreCase: true, out var parsed) ? parsed : SatSection.Math,
                Prompt = q.Prompt ?? "",
                Choices = q.Choices ?? new List<string> { "A", "B", "C", "D" },
                CorrectChoiceIndex = Math.Clamp(q.CorrectChoiceIndex, 0, 3),
                Explanation = q.Explanation ?? ""
            }).ToList() ?? new List<Question>()
        };

        // Ensure exactly 4 choices per question (for basic UI assumptions)
        foreach (var q in exam.Questions)
        {
            if (q.Choices.Count > 4)
                q.Choices = q.Choices.Take(4).ToList();
            while (q.Choices.Count < 4)
                q.Choices.Add($"Choice {q.Choices.Count + 1}");
        }

        return exam;
    }

    private bool IsOpenAiEnabled() =>
        (_options.Provider ?? "Stub").Trim().Equals("OpenAI", StringComparison.OrdinalIgnoreCase);

    private static string FormatChoices(IReadOnlyList<string> choices)
    {
        var lines = new List<string>();
        for (var i = 0; i < choices.Count; i++)
            lines.Add($"- {(char)('A' + i)} ({i}): {choices[i]}");
        return string.Join('\n', lines);
    }

    private static AiVideoPack ParseVideoPack(string text, string fallbackBoardHeader)
    {
        var normalized = (text ?? "").Replace("\r\n", "\n").Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return new AiVideoPack("", new List<string>(), new List<double>());

        var narrationMarker = FindMarker(normalized, "NARRATION:");
        var boardMarker = FindMarker(normalized, "WHITEBOARD:");
        var timingsMarker = FindMarker(normalized, "TIMINGS:");

        if (narrationMarker >= 0 && boardMarker > narrationMarker)
        {
            var narrationStart = narrationMarker + "NARRATION:".Length;
            var narrationEnd = timingsMarker > boardMarker ? Math.Min(boardMarker, timingsMarker) : boardMarker;
            var narration = normalized.Substring(narrationStart, narrationEnd - narrationStart).Trim();

            var boardStart = boardMarker + "WHITEBOARD:".Length;
            var boardEnd = timingsMarker > boardMarker ? timingsMarker : normalized.Length;
            var boardText = normalized.Substring(boardStart, boardEnd - boardStart).Trim();

            var timingsText = "";
            if (timingsMarker > boardMarker)
            {
                var timingsStart = timingsMarker + "TIMINGS:".Length;
                timingsText = normalized.Substring(timingsStart).Trim();
            }

            var boardLines = CleanBoardLines(ParseBoardLines(boardText));
            if (boardLines.Count == 0)
                boardLines = CleanBoardLines(DeriveBoardLines(narration));

            var timings = CleanTimings(ParseTimings(timingsText), boardLines.Count);
            return new AiVideoPack(narration, boardLines, timings);
        }

        // Fallback if the model didn't follow the format.
        var fallbackLines = new List<string> { fallbackBoardHeader };
        fallbackLines.AddRange(DeriveBoardLines(normalized));
        var cleanedBoard = CleanBoardLines(fallbackLines);
        return new AiVideoPack(normalized, cleanedBoard, EvenTimings(cleanedBoard.Count));
    }

    private static int FindMarker(string text, string marker) =>
        text.IndexOf(marker, StringComparison.OrdinalIgnoreCase);

    private static IEnumerable<string> ParseBoardLines(string boardText)
    {
        foreach (var raw in (boardText ?? "").Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;

            if (line.StartsWith("- "))
                line = line.Substring(2).Trim();
            else if (line.StartsWith("• "))
                line = line.Substring(2).Trim();
            else
            {
                // Remove leading numbering like "1) " or "1. "
                var idx = line.IndexOf(' ');
                if (idx > 0 && idx < 6 && (line.Contains(")") || line.Contains(".")))
                {
                    var prefix = line.Substring(0, idx);
                    if (prefix.Any(char.IsDigit))
                        line = line.Substring(idx + 1).Trim();
                }
            }

            yield return line;
        }
    }

    private static List<string> CleanBoardLines(IEnumerable<string> lines)
    {
        var cleaned = new List<string>();

        foreach (var raw in lines)
        {
            var line = (raw ?? "").Trim();
            if (line.Length == 0)
                continue;

            // Keep lines readable on the canvas.
            const int maxChars = 56;
            if (line.Length > maxChars)
                line = line.Substring(0, maxChars - 1) + "…";

            cleaned.Add(line);

            if (cleaned.Count >= 18)
                break;
        }

        return cleaned;
    }

    private static List<double> ParseTimings(string timingsText)
    {
        var timings = new List<double>();

        foreach (var raw in (timingsText ?? "").Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0)
                continue;

            if (line.StartsWith("- "))
                line = line.Substring(2).Trim();
            else if (line.StartsWith("• "))
                line = line.Substring(2).Trim();

            // Support numbering like "1) 0.25"
            var spaceIdx = line.IndexOf(' ');
            if (spaceIdx > 0 && spaceIdx < 6 && line.Take(spaceIdx).Any(char.IsDigit))
                line = line.Substring(spaceIdx + 1).Trim();

            // Support "25%" format
            if (line.EndsWith('%'))
            {
                var percentPart = line.TrimEnd('%').Trim();
                if (double.TryParse(percentPart, NumberStyles.Float, CultureInfo.InvariantCulture, out var pct))
                    timings.Add(pct / 100.0);
                continue;
            }

            if (double.TryParse(line, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                timings.Add(value);
        }

        return timings;
    }

    private static List<double> CleanTimings(List<double> timings, int expectedCount)
    {
        if (expectedCount <= 0)
            return new List<double>();

        if (timings.Count != expectedCount)
            return EvenTimings(expectedCount);

        var cleaned = new List<double>(capacity: expectedCount);
        var prev = -1.0;
        foreach (var raw in timings)
        {
            var v = Math.Clamp(raw, 0.0, 1.0);
            if (v <= prev)
                return EvenTimings(expectedCount);
            cleaned.Add(v);
            prev = v;
        }

        return cleaned;
    }

    private static List<double> EvenTimings(int count)
    {
        if (count <= 0)
            return new List<double>();

        if (count == 1)
            return new List<double> { 0.35 };

        const double start = 0.12;
        const double end = 0.92;
        var step = (end - start) / (count - 1);

        var timings = new List<double>(capacity: count);
        for (var i = 0; i < count; i++)
            timings.Add(start + step * i);

        return timings;
    }

    private static IEnumerable<string> DeriveBoardLines(string narration)
    {
        var normalized = (narration ?? "").Replace("\r\n", "\n");
        var candidates = normalized.Split('\n')
            .Select(l => l.Trim())
            .Where(l => l.Length > 0)
            .ToList();

        // Prefer already-step-like lines.
        var stepLike = candidates
            .Where(l => l.StartsWith("1") || l.StartsWith("2") || l.StartsWith("3") || l.StartsWith("-"))
            .ToList();

        if (stepLike.Count > 0)
            return stepLike;

        // Otherwise, take short sentences.
        var sentences = normalized
            .Replace("?", ".")
            .Replace("!", ".")
            .Split('.', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => s.Length is >= 12 and <= 80)
            .Take(12);

        return sentences;
    }

    private static string? ExtractJsonObject(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var first = text.IndexOf('{');
        var last = text.LastIndexOf('}');
        if (first < 0 || last <= first)
            return null;

        return text.Substring(first, last - first + 1);
    }

    private static Exam GenerateLocalExam(string section, int questionCount)
    {
        var bank = LocalQuestionBank();

        IEnumerable<Question> candidates = section.Equals("Math", StringComparison.OrdinalIgnoreCase)
            ? bank.Where(q => q.Section == SatSection.Math)
            : section.Equals("ReadingWriting", StringComparison.OrdinalIgnoreCase)
                ? bank.Where(q => q.Section == SatSection.ReadingWriting)
                : bank;

        var candidateList = candidates.ToList();
        if (candidateList.Count == 0)
            candidateList = bank;

        var selected = new List<Question>(capacity: questionCount);
        while (selected.Count < questionCount)
        {
            foreach (var q in candidateList.OrderBy(_ => Random.Shared.Next()))
            {
                selected.Add(new Question
                {
                    Id = Guid.NewGuid(),
                    Section = q.Section,
                    Prompt = q.Prompt,
                    Choices = q.Choices.ToList(),
                    CorrectChoiceIndex = q.CorrectChoiceIndex,
                    Explanation = q.Explanation
                });

                if (selected.Count >= questionCount)
                    break;
            }
        }

        return new Exam
        {
            Id = Guid.NewGuid(),
            Title = "Generated SAT Mini Exam (Local)",
            Description = "Generated locally (Stub mode) from an original question bank.",
            IsGenerated = true,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            Questions = selected
        };
    }

    private static List<Question> LocalQuestionBank() =>
    [
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.Math,
            Prompt = "If 5x + 2 = 27, what is the value of x?",
            Choices = ["3", "4", "5", "6"],
            CorrectChoiceIndex = 2,
            Explanation = "Subtract 2: 5x = 25. Divide by 5: x = 5."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.Math,
            Prompt = "A line passes through (0, 4) and (2, 10). What is its slope?",
            Choices = ["2", "3", "4", "6"],
            CorrectChoiceIndex = 1,
            Explanation = "Slope = (10 − 4)/(2 − 0) = 6/2 = 3."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.Math,
            Prompt = "What is the average (mean) of 4, 7, and 13?",
            Choices = ["8", "9", "10", "11"],
            CorrectChoiceIndex = 0,
            Explanation = "Mean = (4 + 7 + 13)/3 = 24/3 = 8."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.Math,
            Prompt = "If y = 3x − 1, what is y when x = 5?",
            Choices = ["12", "13", "14", "15"],
            CorrectChoiceIndex = 2,
            Explanation = "y = 3(5) − 1 = 15 − 1 = 14."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.Math,
            Prompt = "A rectangle has length 9 and width 4. What is its area?",
            Choices = ["13", "18", "26", "36"],
            CorrectChoiceIndex = 3,
            Explanation = "Area = length × width = 9 × 4 = 36."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.ReadingWriting,
            Prompt = "Choose the option that correctly completes the sentence:\n\nEach of the players ____ a jersey.",
            Choices = ["have", "has", "are", "were"],
            CorrectChoiceIndex = 1,
            Explanation = "“Each” is singular, so the verb should be singular: “has.”"
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.ReadingWriting,
            Prompt = "Choose the best transition:\n\nThe first draft was messy; ____, it contained several strong ideas.",
            Choices = ["nevertheless", "therefore", "as a result", "for instance"],
            CorrectChoiceIndex = 0,
            Explanation = "The second clause contrasts with “messy,” so a contrast transition like “nevertheless” fits."
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.ReadingWriting,
            Prompt = "Choose the best word to complete the sentence:\n\nThe directions were so ____ that everyone understood them immediately.",
            Choices = ["ambiguous", "opaque", "clear", "ornate"],
            CorrectChoiceIndex = 2,
            Explanation = "If everyone understood immediately, the directions were “clear.”"
        },
        new()
        {
            Id = Guid.Empty,
            Section = SatSection.ReadingWriting,
            Prompt = "Choose the sentence that is most grammatically correct:",
            Choices =
            [
                "Running quickly, the finish line was crossed by Maya.",
                "Running quickly, Maya crossed the finish line.",
                "Maya, running quickly the finish line crossed.",
                "Maya crossed, running quickly, the finish line it."
            ],
            CorrectChoiceIndex = 1,
            Explanation = "Choice B correctly attaches the introductory phrase to the person doing the action (Maya)."
        }
    ];

    private sealed class GeneratedExamDto
    {
        public string? Title { get; set; }
        public string? Description { get; set; }
        public List<GeneratedQuestionDto>? Questions { get; set; }
    }

    private sealed class GeneratedQuestionDto
    {
        public string Section { get; set; } = "Math";
        public string? Prompt { get; set; }
        public List<string>? Choices { get; set; }
        public int CorrectChoiceIndex { get; set; }
        public string? Explanation { get; set; }
    }
}
