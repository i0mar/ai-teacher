using System.Text.Json;
using System.Globalization;
using System.Text.RegularExpressions;
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

    public async Task<string> GenerateLessonScriptAsync(string topic, LessonLength length, CancellationToken ct)
    {
        var pack = await GenerateLessonVideoAsync(topic, length, ct);
        return pack.Narration;
    }

    public async Task<AiVideoPack> GenerateLessonVideoAsync(string topic, LessonLength length, CancellationToken ct)
    {
        topic = (topic ?? "").Trim();
        if (string.IsNullOrWhiteSpace(topic))
            return new AiVideoPack("", new List<string>(), new List<double>());

        var isShortLesson = length == LessonLength.Short;

        if (!IsOpenAiEnabled())
        {
            var t = topic.ToLowerInvariant();
            var isSystem = t.Contains("system");
            var isLinear = t.Contains("linear") || t.Contains("slope") || t.Contains("intercept");
            var isPercent = t.Contains("percent") || t.Contains("unit rate") || t.Contains("rate");
            var isTriangle = t.Contains("triangle") || t.Contains("pythagorean");
            var isGraphs = t.Contains("graph") || t.Contains("graphs") || t.Contains("table") || t.Contains("tables");

            if (isShortLesson)
            {
                var shortNarration =
                    $"Today we're learning: {topic}.\n\n" +
                    "Quick plan: one core rule, one worked example, and one fast check.\n" +
                    "Follow this exact rhythm on test day: translate, set up, solve, and verify.\n\n";

                var shortLines = new List<string> { $"TOPIC: {topic}" };

                if (isTriangle)
                {
                    shortNarration +=
                        "Core rule: in a right triangle, the square of the hypotenuse equals the sum of the squares of the legs.\n" +
                        "Example: with legs 3 and 4, the hypotenuse is 5.\n" +
                        "Quick check: with legs 5 and 12, the hypotenuse is 13.";
                    shortLines.AddRange(new[]
                    {
                        "Pythagorean theorem: a^2 + b^2 = c^2",
                        "Example: a=3, b=4",
                        "c^2 = 9 + 16 = 25",
                        "c = 5",
                        "Quick check: a=5, b=12 -> c=13"
                    });
                }
                else if (isPercent)
                {
                    shortNarration +=
                        "Core rule: percent change is new minus old, over old.\n" +
                        "Example: from 50 to 60, the change is 20 percent.\n" +
                        "Quick check: always carry units when finding unit rates.";
                    shortLines.AddRange(new[]
                    {
                        "Percent change = (new - old) / old",
                        "Example: old=50, new=60",
                        "(60-50)/50 = 10/50 = 20%",
                        "Unit rate = total / units",
                        "Quick check: keep units attached"
                    });
                }
                else if (isSystem)
                {
                    shortNarration +=
                        "Core rule: for systems, make both equations speak about the same variable, then solve.\n" +
                        "Example: y equals two x plus one, and y equals negative x plus seven gives x equals 2 and y equals 5.\n" +
                        "Quick check: always verify in both original equations.";
                    shortLines.AddRange(new[]
                    {
                        "System: y = 2x + 1 and y = -x + 7",
                        "Set equal: 2x+1 = -x+7",
                        "3x = 6 -> x = 2",
                        "y = 5",
                        "Check both equations"
                    });
                }
                else if (isLinear || isGraphs)
                {
                    shortNarration +=
                        "Core rule: slope-intercept form is y equals m x plus b, where m is slope and b is intercept.\n" +
                        "Example: y equals two x plus one crosses at 1 and rises 2 for every run of 1.\n" +
                        "Quick check: plug in a point to verify the equation.";
                    shortLines.AddRange(new[]
                    {
                        "Slope-intercept form: y = mx + b",
                        "Example line: y = 2x + 1",
                        "x=0 -> y=1",
                        "x=3 -> y=7",
                        "Quick check: substitute back"
                    });
                }
                else
                {
                    shortNarration +=
                        "Core rule: identify the pattern before computing.\n" +
                        "Example: rewrite the prompt into a clean equation, then solve step by step.\n" +
                        "Quick check: test whether your answer matches the question's exact ask.";
                    shortLines.AddRange(new[]
                    {
                        "Goal: identify the pattern",
                        "Method: translate -> set up -> solve -> verify",
                        "Example: rewrite into equation",
                        "Solve step-by-step",
                        "Quick check: does answer match ask?"
                    });
                }

                var shortBoard = CleanBoardLines(shortLines);
                return new AiVideoPack(HumanizeNarration(shortNarration), shortBoard, EvenTimings(shortBoard.Count));
            }

            var fallbackNarration =
                $"Today we're learning: {topic}.\n\n" +
                "This lesson is intentionally long-form so you can build real mastery, not just memorize one trick.\n" +
                "Roadmap:\n" +
                "1) Core concept and SAT framing\n" +
                "2) Worked Example A\n" +
                "3) Worked Example B\n" +
                "4) Mixed practice and mini-quiz\n" +
                "5) Common mistakes and final recap\n\n" +
                "As we go, solve each checkpoint before reading the answer. That active recall habit is what improves your score.\n\n" +
                "Part 1 - Core concept:\n" +
                "First, identify what the question is really testing. SAT items often hide the core skill in extra wording, so we practice rewriting the prompt in plain language before solving.\n\n" +
                "Part 2 - Worked examples:\n" +
                "For each example, we set up the structure, solve step by step, and verify with a quick check. Verification is required, not optional.\n\n" +
                "Part 3 - Mixed practice:\n" +
                "We then switch contexts to test transfer. If you can solve the same idea in a different format, you actually learned it.\n\n" +
                "Part 4 - Error analysis:\n" +
                "Finally, we catalog common traps and create short self-check questions you can use on future problems.";

            var fallbackLines = new List<string> { $"TOPIC: {topic}" };

            if (isTriangle)
            {
                fallbackNarration +=
                    "\n\nTriangle focus:\n" +
                    "Example A uses a standard 3-4-5 right triangle to reinforce setup and notation.\n" +
                    "Example B changes the numbers and asks you to isolate the unknown leg instead of the hypotenuse.\n" +
                    "Then we run a short quiz with one direct and one reverse-setup question.";
                fallbackLines.AddRange(new[]
                {
                    "Pythagorean theorem: a^2 + b^2 = c^2",
                    "Example: a=3, b=4",
                    "c^2 = 3^2 + 4^2 = 9 + 16 = 25",
                    "c = 5",
                    "DRAW: triangle right 3 4 5",
                    "Mini-quiz: a=5, b=12, find c",
                    "Answer: c^2=25+144=169 -> c=13",
                    "Trap: don't forget to sqrt at the end"
                });
            }
            else if (isPercent)
            {
                fallbackNarration +=
                    "\n\nPercent focus:\n" +
                    "Example A covers percent change from old to new value.\n" +
                    "Example B covers unit rate and comparison language.\n" +
                    "Then we do mixed quick checks with units, because unit confusion is the most common error.";
                fallbackLines.AddRange(new[]
                {
                    "Percent change = (new - old) / old",
                    "Example: old=50, new=60",
                    "(60-50)/50 = 10/50 = 0.2 = 20%",
                    "DRAW: bar Old=50 New=60",
                    "Unit rate = total / units",
                    "Example: $12 for 4 items -> $3/item",
                    "Trap: keep units with your numbers"
                });
            }
            else if (isSystem)
            {
                fallbackNarration +=
                    "\n\nSystems focus:\n" +
                    "Example A solves by substitution and graph interpretation.\n" +
                    "Example B solves by elimination with sign control.\n" +
                    "Then we run a checkpoint where you identify no-solution versus one-solution cases.";
                fallbackLines.AddRange(new[]
                {
                    "System: y = 2x + 1 and y = -x + 7",
                    "Set equal: 2x+1 = -x+7",
                    "3x = 6 -> x = 2",
                    "y = 2(2)+1 = 5",
                    "Solution: (2, 5)",
                    "DRAW: axes x=-1..6 y=0..8",
                    "DRAW: line y=2x+1",
                    "DRAW: line y=-x+7",
                    "DRAW: point (2,5) label=(2,5)",
                    "Trap: check in BOTH equations"
                });
            }
            else if (isLinear || isGraphs)
            {
                fallbackNarration +=
                    "\n\nLinear/graph focus:\n" +
                    "Example A links slope-intercept form to visual slope and intercept.\n" +
                    "Example B starts from points and builds the equation.\n" +
                    "Then we do transfer practice by switching between equation, table, and graph views.";
                fallbackLines.AddRange(new[]
                {
                    "Slope-intercept form: y = mx + b",
                    "Example line: y = 2x + 1",
                    "Pick x: 0 -> y=1",
                    "Pick x: 3 -> y=7",
                    "DRAW: axes x=-2..8 y=-2..10",
                    "DRAW: line y=2x+1",
                    "DRAW: point (0,1) label=(0,1)",
                    "DRAW: point (3,7) label=(3,7)",
                    "Trap: slope is rise/run, not just 'the bigger number'"
                });
            }
            else
            {
                fallbackNarration +=
                    "\n\nGeneral strategy focus:\n" +
                    "We use two full worked examples, then a guided mini-quiz, then a trap review.\n" +
                    "The goal is durable process: translate -> set up -> solve -> verify -> reflect.";
                fallbackLines.AddRange(new[]
                {
                    "Goal: recognize the pattern",
                    "Rule: write the key formula",
                    "Example 1: set up the problem",
                    "Example 1: solve step-by-step",
                    "Example 2: same idea, new numbers",
                    "Mini-quiz: try it yourself",
                    "Trap: watch signs/units",
                    "Takeaway: method > memorizing"
                });
            }

            var fallbackBoard = CleanBoardLines(fallbackLines);
            return new AiVideoPack(HumanizeNarration(fallbackNarration), fallbackBoard, EvenTimings(fallbackBoard.Count));
        }

        const string systemPrompt =
            "You are an expert SAT tutor who teaches like a real classroom teacher. " +
            "Write in a friendly spoken voice and include what to write on a whiteboard. " +
            "Anything you solve in narration must also appear on the board as explicit intermediate steps. " +
            "Avoid referencing copyrighted SAT questions. Return plain text only (no markdown).";

        var t2 = topic.ToLowerInvariant();
        var needsGraph = t2.Contains("graph") || t2.Contains("graphs") || t2.Contains("table") || t2.Contains("tables");
        var needsSystem = t2.Contains("system");
        var needsLinear = t2.Contains("linear") || t2.Contains("slope") || t2.Contains("intercept");
        var needsPercent = t2.Contains("percent") || t2.Contains("unit rate") || t2.Contains("rate");
        var needsTriangle = t2.Contains("triangle") || t2.Contains("pythagorean");
        var requiresMathDiagram = needsTriangle || needsPercent || needsSystem || needsLinear || needsGraph;
        var isVerbalTopic =
            ContainsAny(t2,
                "transition", "grammar", "punctuation", "vocab", "vocabulary",
                "reading", "writing", "rhetoric", "evidence", "inference",
                "tone", "sentence", "paragraph", "clause", "pronoun", "verb", "conjunction")
            && !requiresMathDiagram;

        var diagramRequirement =
            needsTriangle
                ? "- Diagram requirement (required): include a right-triangle diagram AND point at it while explaining.\n" +
                  "  - DRAW: triangle right; legs a,b; hypotenuse c\n" +
                  "  - DRAW: focus hyp\n"
                : needsPercent
                    ? "- Diagram requirement (required): include a bar chart AND point to a bar while explaining.\n" +
                      "  - DRAW: bar Old=50 New=60\n" +
                      "  - DRAW: focus bar New\n"
                    : needsSystem
                        ? "- Diagram requirement (required): include a coordinate graph of your worked example system AND point to the intersection.\n" +
                          "  - DRAW: axes x=-5..5 y=-5..5\n" +
                          "  - DRAW: line y=2x+1\n" +
                          "  - DRAW: line y=-x+7\n" +
                          "  - DRAW: point (2,5) label=(2,5)\n" +
                          "  - DRAW: focus (2,5)\n"
                        : (needsLinear || needsGraph)
                            ? "- Diagram requirement (required): include a coordinate graph of your worked example line AND point to a key point.\n" +
                              "  - DRAW: axes x=-5..5 y=-5..5\n" +
                              "  - DRAW: line y=2x+1\n" +
                              "  - DRAW: point (0,1) label=(0,1)\n" +
                              "  - DRAW: focus (0,1)\n"
                            : "";

        var drawPolicy =
            requiresMathDiagram
                ? "- Draw policy: include diagrams only where they materially help the concept.\n"
                : isVerbalTopic
                    ? "- Draw policy: this is a verbal/non-quantitative topic. DO NOT use any DRAW lines, plots, graphs, or geometric shapes. Use text-only whiteboard lines.\n"
                    : "- Draw policy: use DRAW lines only if absolutely necessary; otherwise keep whiteboard text-only.\n";

        var drawUsageRules =
            requiresMathDiagram
                ? "- If you use DRAW steps, explicitly switch between the text board and the diagram (e.g., \"On the left...\" then \"On the graph...\").\n" +
                  "- Interleave: go back-and-forth between text steps and diagram steps (don't dump all DRAW lines at the end).\n" +
                  "- If you include a diagram, include at least 2 \"DRAW: focus ...\" lines at different moments to point while you explain.\n" +
                  "- The diagram panel shows ONE diagram at a time. If you switch to a new diagram (axes/bar/triangle), add \"DRAW: clear\" first.\n" +
                  "- Only use \"DRAW: focus ...\" on something you already drew earlier (or draw it immediately before focusing).\n" +
                  "- If you say \"plot\" or mention specific points/lines/bars in text, include matching DRAW commands (e.g., \"DRAW: point (1,2) label=P\").\n" +
                  "- If you want to update a shape later, give it an id and reuse it (e.g., triangle id=t1 ... then triangle id=t1 angles ...).\n"
                : isVerbalTopic
                    ? "- Do not emit any line beginning with \"DRAW:\".\n"
                    : "- If you use DRAW steps, use at most 1-2 simple DRAW lines and only when they clearly improve understanding.\n";

        var optionalDrawExamples =
            requiresMathDiagram
                ? "- Optional diagrams: if a quick graph/diagram helps, include 1–4 WHITEBOARD lines that start with \"DRAW:\" (these still need timings). Examples:\n" +
                  "  - DRAW: axes x=-5..5 y=-5..5\n" +
                  "  - DRAW: line y=2x+1\n" +
                  "  - DRAW: point (3,7) label=(3,7)\n" +
                  "  - DRAW: bar A=2 B=5 C=3\n" +
                  "  - DRAW: triangle right 3 4 5\n" +
                  "  - DRAW: triangle right; legs a,b; hypotenuse c\n" +
                  "  - DRAW: circle id=c1 center=(0,0) r=3\n" +
                  "  - DRAW: square id=s1 center=(2,2) size=2 angle=20\n" +
                  "  - DRAW: triangle id=t1 angles 40 50 90\n" +
                  "  - DRAW: move id=c1 x=1 y=2\n" +
                  "  - DRAW: focus (3,7)\n" +
                  "  - DRAW: focus bar New\n" +
                  "  - DRAW: focus hyp\n" +
                  "  - DRAW: focus right angle\n" +
                  "  - DRAW: clear\n"
                : "";

        var lessonDurationLabel = isShortLesson ? "~3-5 minute" : "~12-18 minute";
        var narrationLengthRequirement = isShortLesson
            ? "- Narration length: roughly 420-700 words (about 3-5 minutes at 1.0x). Keep it concise and complete.\n"
            : "- Narration length: MUST be long-form, roughly 1700-2500 words (about 12-18 minutes at 1.0x). Do not return a short script.\n";
        var narrationContentRequirement = isShortLesson
            ? "- Narration: start with a 1-sentence hook, teach with at least 2 worked examples, include a 2-question quick check + fully worked solutions, and end with 3 takeaways + 3 common mistakes.\n"
            : "- Narration: start with a 1-sentence hook, teach with at least 6 worked examples, include a 5-question mini-quiz + fully worked solutions, end with 5 takeaways + 5 common mistakes.\n";
        var whiteboardSizeRequirement = isShortLesson
            ? "- Whiteboard: 14-24 total lines (including DRAW), max ~56 chars for text lines, using ASCII math (no LaTeX).\n"
            : "- Whiteboard: 30-48 total lines (including DRAW), max ~56 chars for text lines, using ASCII math (no LaTeX).\n";
        var boardContentRequirement = isShortLesson
            ? "- Include core teaching content on board: key rule/formula, worked-example prompts, quick-check questions, full worked solutions, and final checks.\n"
            : "- Include core teaching content on board: key rule/formula, worked-example prompts, mini-quiz questions, full worked solutions, and final checks.\n";
        var boardCoverageRequirement = isShortLesson
            ? "- Board coverage requirement: for each worked example and quick-check question, write the full board solution flow with all major algebra/logic transformations (setup -> equation steps -> simplification -> final answer -> check).\n"
            : "- Board coverage requirement: for each worked example and mini-quiz question, write the full board solution flow with all major algebra/logic transformations (setup -> equation steps -> simplification -> final answer -> check).\n";

        var userPrompt =
            $"Create a {lessonDurationLabel} SAT lesson script on this topic:\n\n{topic}\n\n" +
            "Output format EXACTLY:\n" +
            "NARRATION:\n" +
            "(spoken lesson script)\n\n" +
            "SPOKEN_LINES:\n" +
            "- (spoken line aligned to board line 1)\n" +
            "- (spoken line aligned to board line 2)\n" +
            "...\n\n" +
            "WHITEBOARD:\n" +
            "- (short line 1)\n" +
            "- (short line 2)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "- 00:12\n" +
            "- 00:25\n" +
            "...\n\n" +
            "Requirements:\n" +
            narrationLengthRequirement +
            narrationContentRequirement +
            "- Depth requirement: do not skip reasoning. For each example and quiz item, explicitly walk through Step 1, Step 2, ... with why each transformation is valid.\n" +
            "- Narration style: conversational human cadence with short natural breaks between major steps (use natural punctuation and brief transition sentences).\n" +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            drawPolicy +
            whiteboardSizeRequirement +
            "- Board completeness rule: write every material step on the board. If narration performs a setup, substitution, transformation, elimination, simplification, or check, put that move on its own board line.\n" +
            "- Omit only filler transition phrases; when deciding between brevity and completeness, prefer writing the step.\n" +
            boardContentRequirement +
            boardCoverageRequirement +
            "- Include solution lines, not just prompts: show intermediate equations and substitutions, then the final verified answer.\n" +
            "- Do not collapse multiple algebra or logic moves into one board line just to save space.\n" +
            "- Narration must explain each non-DRAW board line at the same moment, but in natural spoken language (do not read symbols or shorthand literally).\n" +
            "- SPOKEN_LINES: include exactly one spoken line per whiteboard line, in the same order and same count.\n" +
            "- Each spoken line should sound like a real teacher sentence or two, not a symbol-by-symbol reading.\n" +
            "- Treat SPOKEN_LINES as the exact narration beats used for sync, so each line must focus on that single board step.\n" +
            "- Spoken style rule: expand shorthand and symbols when speaking (e.g., 'ex' -> 'example', 'eqn' -> 'equation', '->' -> 'therefore', '^' -> 'to the power of').\n" +
            drawUsageRules +
            diagramRequirement +
            optionalDrawExamples +
            "- For DRAW lines, use ASCII only (use '-' not '−') and keep commands short (no full sentences).\n" +
            "- Timings: one timestamp per whiteboard line (same count), strictly increasing, format MM:SS (or HH:MM:SS).\n" +
            "- Each timestamp is when that line should START being written from narration start time.\n" +
            "- Do NOT start writing a line before the narration reaches that step.\n";

        var minNarrationWords = isShortLesson ? 360 : 1550;
        var maxNarrationWords = isShortLesson ? 760 : int.MaxValue;
        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var pack = ParseVideoPack(text, fallbackBoardHeader: $"TOPIC: {topic}");

        if (isShortLesson)
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var words = CountWords(pack.Narration);
                if (words >= minNarrationWords && words <= maxNarrationWords)
                    break;

                var lengthDirection = words < minNarrationWords
                    ? "too short"
                    : "too long";
                var retryPrompt = userPrompt +
                    "\nCRITICAL LENGTH ENFORCEMENT:\n" +
                    $"- Prior draft length was {words} words, which is {lengthDirection}.\n" +
                    "- Narration MUST be 420-700 words and stay under 5 minutes.\n" +
                    "- Keep the same output format (NARRATION/SPOKEN_LINES/WHITEBOARD/TIMINGS).\n" +
                    "- Preserve full board coverage: every material transformation from narration must appear as its own board line.\n" +
                    "- Keep reasoning explicit but concise; do not add extra sections beyond the requested structure.\n";

                text = await _ai.CompleteAsync(systemPrompt, retryPrompt, ct);
                pack = ParseVideoPack(text, fallbackBoardHeader: $"TOPIC: {topic}");
            }
        }
        else
        {
            // Retry with stricter constraints if narration is still too short.
            for (var attempt = 0; attempt < 3 && CountWords(pack.Narration) < minNarrationWords; attempt++)
            {
                var retryPrompt = userPrompt +
                    "\nCRITICAL LENGTH ENFORCEMENT:\n" +
                    $"- Prior draft length was {CountWords(pack.Narration)} words, which is too short.\n" +
                    "- Narration MUST be 1700-2500 words.\n" +
                    "- Keep the same output format (NARRATION/SPOKEN_LINES/WHITEBOARD/TIMINGS).\n" +
                    "- Preserve full board coverage: every material transformation from narration must appear as its own board line.\n" +
                    "- Expand depth with more explicit numbered substeps and full board-written solutions.\n" +
                    "- Do not summarize; teach fully with clear transitions, intermediate equations, checks, and practice.\n";

                text = await _ai.CompleteAsync(systemPrompt, retryPrompt, ct);
                pack = ParseVideoPack(text, fallbackBoardHeader: $"TOPIC: {topic}");
            }

        }

        // Hard guard: verbal topics should not draw graphs/shapes.
        if (isVerbalTopic)
        {
            var safeNarration = HumanizeNarration(pack.Narration);
            var textOnlyBoard = CleanBoardLines((pack.BoardLines ?? new List<string>())
                .Where(l => !IsDrawLine(l)));
            if (textOnlyBoard.Count == 0)
                textOnlyBoard = CleanBoardLines(DeriveBoardLines(safeNarration));
            pack = new AiVideoPack(safeNarration, textOnlyBoard, EvenTimings(textOnlyBoard.Count));
        }

        return pack with { Narration = HumanizeNarration(pack.Narration) };
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
                return new AiVideoPack(HumanizeNarration(question.Explanation), board, EvenTimings(board.Count));
            }

            const string fallbackNarration = "Explanation unavailable in Stub mode for this question.";
            var fallbackBoard = CleanBoardLines(DeriveBoardLines(fallbackNarration));
            return new AiVideoPack(HumanizeNarration(fallbackNarration), fallbackBoard, EvenTimings(fallbackBoard.Count));
        }

        const string systemPrompt =
            "You are an expert SAT tutor. Explain solutions step-by-step with clear reasoning. " +
            "Teach like a real teacher: say what you'd write on the board. " +
            "Anything you solve in narration must also appear on the board as explicit intermediate steps. " +
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
            "SPOKEN_LINES:\n" +
            "1) (spoken line aligned to board line 1)\n" +
            "2) (spoken line aligned to board line 2)\n" +
            "...\n\n" +
            "WHITEBOARD:\n" +
            "1) (short line)\n" +
            "2) (short line)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "1) 00:08\n" +
            "2) 00:21\n" +
            "...\n\n" +
            "Requirements:\n" +
            "- Narration: identify the correct answer (A/B/C/D), explain why, step-by-step, and mention common traps.\n" +
            "- Narration style: clear human cadence, natural breaks, and short transition sentences between steps.\n" +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            "- Whiteboard: 14–28 short lines, max ~56 characters each, showing full solution steps from setup to final answer/check.\n" +
            "- Board completeness rule: write every material step on the board. If narration performs a setup, elimination, substitution, transformation, simplification, or check, put that move on its own board line.\n" +
            "- Omit only filler transition phrases; when deciding between brevity and completeness, prefer writing the step.\n" +
            "- Depth requirement: write full chain-of-work on the board, including key intermediate transformations (not just first and last line).\n" +
            "- Do not collapse multiple algebra or logic moves into one board line just to save space.\n" +
            "- For multiple-choice elimination, write why each eliminated option fails when relevant.\n" +
            "- Narration must explain each non-DRAW board line at the same moment, but in natural spoken language (do not read symbols or shorthand literally).\n" +
            "- SPOKEN_LINES: include exactly one spoken line per whiteboard line, in the same order and same count.\n" +
            "- Each spoken line should sound like a human teacher beat that matches that board step.\n" +
            "- Spoken style rule: expand shorthand and symbols when speaking (e.g., 'ex' -> 'example', 'eqn' -> 'equation', '->' -> 'therefore', '^' -> 'to the power of').\n" +
            "- Optional diagrams: if a quick graph/diagram helps, include 1–3 WHITEBOARD lines starting with \"DRAW:\" (still counted as lines and need timings). Use simple commands like:\n" +
            "  - DRAW: axes x=-5..5 y=-5..5\n" +
            "  - DRAW: line y=2x+1\n" +
            "  - DRAW: point (3,7) label=(3,7)\n" +
            "  - DRAW: bar A=2 B=5 C=3\n" +
            "  - DRAW: triangle right 3 4 5\n" +
            "  - DRAW: triangle right; legs a,b; hypotenuse c\n" +
            "  - DRAW: circle id=c1 center=(0,0) r=3\n" +
            "  - DRAW: square id=s1 center=(2,2) size=2 angle=20\n" +
            "  - DRAW: move id=s1 x=1 y=2\n" +
            "- If you update/reuse a shape, include a stable id= in those DRAW lines.\n" +
            "- For DRAW lines, use ASCII only (use '-' not '−') and keep commands short.\n" +
            "- Use ASCII math (no LaTeX).\n" +
            "- Timings: one timestamp per whiteboard line (same count), strictly increasing, format MM:SS (or HH:MM:SS).\n" +
            "- Each timestamp is when that line should START being written from narration start time.\n" +
            "- Narration length: roughly 450-700 words so the full reasoning is explained clearly.\n";

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
                "Great question. Let me answer it clearly.\n\n" +
                "AI isn't configured yet, so I can't generate a real-time answer.\n" +
                "Set Ai__Provider=OpenAI and Ai__OpenAi__ApiKey, then try again.\n\n" +
                "Alright—now let's jump back into the lesson.";

            var header = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";
            var board = CleanBoardLines(new[] { header, "Enable OpenAI to answer." });
            return new AiVideoPack(HumanizeNarration(fallbackNarration), board, EvenTimings(board.Count));
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
            "A student asked a question during the lesson, and you will answer it, then smoothly return to the lesson. " +
            "Be friendly, natural, and step-by-step when helpful. " +
            "Anything you solve in narration must also appear on the board as explicit intermediate steps. " +
            "Use plain text only (no markdown). " +
            "Avoid referencing copyrighted SAT questions.";

        var headerLine = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";

        var userPrompt =
            $"Video title: {video.Title}\n" +
            $"Video type: {video.SourceType}\n" +
            (clampedProgress is null ? "" : $"Lesson position: ~{(int)Math.Round(clampedProgress.Value * 100)}% of the lesson\n") +
            (recentLines.Count == 0 ? "" : $"Whiteboard so far (most recent):\n- {string.Join("\n- ", recentLines)}\n") +
            "\nLesson narration (context):\n" +
            (string.IsNullOrWhiteSpace(script) ? "(No script available.)" : script) +
            "\n\nStudent question:\n" +
            q +
            "\n\nOutput format EXACTLY:\n" +
            "NARRATION:\n" +
            "(what you will say out loud)\n\n" +
            "SPOKEN_LINES:\n" +
            "- (spoken line aligned to board line 1)\n" +
            "- (spoken line aligned to board line 2)\n" +
            "...\n\n" +
            "WHITEBOARD:\n" +
            "- (short line 1)\n" +
            "- (short line 2)\n" +
            "...\n\n" +
            "TIMINGS:\n" +
            "- 00:05\n" +
            "- 00:14\n" +
            "...\n\n" +
            "Requirements:\n" +
            "- Narration MUST start by acknowledging the question (e.g., \"Great question—let's answer it clearly.\")\n" +
            "- Narration MUST end with returning to the lesson (e.g., \"Alright—now let's jump back into the lesson.\")\n" +
            "- Keep it brief: ~20–60 seconds spoken.\n" +
            "- Narration style: human and clear, with brief natural breaks between key points.\n" +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            "- Do NOT mention pausing/resuming playback. Avoid words like \"pause\" or \"paused\" in narration.\n" +
            $"- Whiteboard: 6–14 short lines, max ~56 characters each. First line MUST be exactly: {headerLine}\n" +
            "- Board completeness rule: write every material step on the board. If narration performs a setup, substitution, transformation, simplification, or check, put that move on its own board line.\n" +
            "- Omit only filler transition phrases; when deciding between brevity and completeness, prefer writing the step.\n" +
            "- Do not collapse multiple algebra or logic moves into one board line just to save space.\n" +
            "- Narration must explain each non-DRAW board line at the same moment, but in natural spoken language (do not read symbols or shorthand literally).\n" +
            "- SPOKEN_LINES: include exactly one spoken line per whiteboard line, in the same order and same count.\n" +
            "- Each spoken line should sound like a brief real-teacher beat tied to that one board step.\n" +
            "- Spoken style rule: expand shorthand and symbols when speaking (e.g., 'ex' -> 'example', 'eqn' -> 'equation', '->' -> 'therefore', '^' -> 'to the power of').\n" +
            "- Use ASCII math (no LaTeX).\n" +
            "- Optional diagrams: if it helps, include 1–2 WHITEBOARD lines starting with \"DRAW:\" (still counted as lines and need timings).\n" +
            "- You may use shape ids to update a prior shape, e.g., \"DRAW: circle id=c1 ...\" then \"DRAW: move id=c1 x=... y=...\".\n" +
            "- For DRAW lines, use ASCII only (use '-' not '−') and keep commands short.\n" +
            "- Timings: one timestamp per whiteboard line (same count), strictly increasing, format MM:SS (or HH:MM:SS).\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var pack = ParseVideoPack(text, fallbackBoardHeader: headerLine);

        var narration = HumanizeNarration(pack.Narration);
        if (string.IsNullOrWhiteSpace(narration))
        {
            narration = HumanizeNarration(
                "Great question—let's answer it clearly.\n\n" +
                (text ?? "").Trim() +
                "\n\nAlright—now let's jump back into the lesson.");
        }

        var finalBoard = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var narrationSegments = CleanNarrationSegments(pack.NarrationSegments ?? new List<string>());
        var timings = CleanTimings(new List<double>(pack.BoardTimings ?? new List<double>()), finalBoard.Count, narration);
        var timestampSeconds = CleanTimestampSeconds(new List<double>(pack.BoardTimestampSeconds ?? new List<double>()), finalBoard.Count, narration);

        if (finalBoard.Count == 0)
        {
            finalBoard = CleanBoardLines(DeriveBoardLines(narration));
            timings = EvenTimings(finalBoard.Count);
            timestampSeconds = new List<double>();
        }

        if (!string.IsNullOrWhiteSpace(headerLine))
        {
            if (finalBoard.Count == 0 || !string.Equals(finalBoard[0], headerLine, StringComparison.OrdinalIgnoreCase))
            {
                finalBoard.Insert(0, headerLine);
                narrationSegments = new List<string>();
                timings = EvenTimings(finalBoard.Count);
                timestampSeconds = new List<double>();
            }
        }

        if (finalBoard.Count > 14)
        {
            finalBoard = finalBoard.Take(14).ToList();
            narrationSegments = narrationSegments.Take(finalBoard.Count).ToList();
            timings = timings.Take(finalBoard.Count).ToList();
            timestampSeconds = timestampSeconds.Take(finalBoard.Count).ToList();
            if (timestampSeconds.Count != finalBoard.Count)
                timestampSeconds = new List<double>();
        }

        if (narrationSegments.Count != finalBoard.Count)
            narrationSegments = new List<string>();

        timings = CleanTimings(timings, finalBoard.Count, narration);
        timestampSeconds = CleanTimestampSeconds(timestampSeconds, finalBoard.Count, narration);
        return new AiVideoPack(narration, finalBoard, timings, timestampSeconds, narrationSegments);
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

        var boardMarker = FindMarker(normalized, "WHITEBOARD:");
        if (boardMarker >= 0)
        {
            var narrationText = ExtractSectionText(normalized, "NARRATION:", "SPOKEN_LINES:", "WHITEBOARD:", "TIMINGS:", "TIMESTAMPS:");
            var spokenLinesText = ExtractSectionText(normalized, "SPOKEN_LINES:", "WHITEBOARD:", "TIMINGS:", "TIMESTAMPS:");
            var boardText = ExtractSectionText(normalized, "WHITEBOARD:", "TIMINGS:", "TIMESTAMPS:");
            var timingsText = ExtractSectionText(normalized, "TIMINGS:");
            if (string.IsNullOrWhiteSpace(timingsText))
                timingsText = ExtractSectionText(normalized, "TIMESTAMPS:");

            var boardLines = CleanBoardLines(ParseBoardLines(boardText));
            var narrationSegments = CleanNarrationSegments(ParseBoardLines(spokenLinesText));
            if (narrationSegments.Count != boardLines.Count)
                narrationSegments = new List<string>();

            var narration = BuildNarrationFromSegments(narrationSegments, narrationText);
            if (boardLines.Count == 0)
                boardLines = CleanBoardLines(DeriveBoardLines(narration));

            var rawTimings = ParseTimings(timingsText);
            var timings = CleanTimings(rawTimings, boardLines.Count, narration);
            var timestampSeconds = CleanTimestampSeconds(rawTimings, boardLines.Count, narration);
            return new AiVideoPack(narration, boardLines, timings, timestampSeconds, narrationSegments);
        }

        // Fallback if the model didn't follow the format.
        var fallbackLines = new List<string> { fallbackBoardHeader };
        fallbackLines.AddRange(DeriveBoardLines(normalized));
        var cleanedBoard = CleanBoardLines(fallbackLines);
        return new AiVideoPack(HumanizeNarration(normalized), cleanedBoard, EvenTimings(cleanedBoard.Count));
    }

    private static int FindMarker(string text, string marker) =>
        text.IndexOf(marker, StringComparison.OrdinalIgnoreCase);

    private static string ExtractSectionText(string text, string marker, params string[] nextMarkers)
    {
        var start = FindMarker(text, marker);
        if (start < 0)
            return "";

        start += marker.Length;
        var end = text.Length;
        foreach (var nextMarker in nextMarkers)
        {
            var idx = FindMarker(text, nextMarker);
            if (idx > start && idx < end)
                end = idx;
        }

        return text[start..end].Trim();
    }

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

            // Keep lines readable on the canvas (draw commands can be longer).
            var isDraw =
                line.StartsWith("DRAW:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("DRAW ", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("DRAW-", StringComparison.OrdinalIgnoreCase);
            var maxChars = isDraw ? 220 : 56;
            if (line.Length > maxChars)
                line = isDraw ? line.Substring(0, maxChars) : line.Substring(0, maxChars - 1) + "…";

            cleaned.Add(line);

            if (cleaned.Count >= 40)
                break;
        }

        return cleaned;
    }

    private static List<string> CleanNarrationSegments(IEnumerable<string> lines)
    {
        var cleaned = new List<string>();
        foreach (var raw in lines)
        {
            var segment = HumanizeNarration(raw);
            if (segment.Length == 0)
                continue;

            cleaned.Add(segment);
        }

        return cleaned;
    }

    private static string BuildNarrationFromSegments(IReadOnlyList<string> segments, string? fallbackNarration)
    {
        if (segments is { Count: > 0 })
            return HumanizeNarration(string.Join("\n\n", segments));

        return HumanizeNarration(fallbackNarration);
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

            // Support optional "[00:12]" wrappers and inline notes after "|".
            if (line.StartsWith("["))
            {
                var closeIdx = line.IndexOf(']');
                if (closeIdx > 1)
                    line = line.Substring(1, closeIdx - 1).Trim();
            }

            var pipeIdx = line.IndexOf('|');
            if (pipeIdx > 0)
                line = line.Substring(0, pipeIdx).Trim();

            if (TryParseTimingToken(line, out var value))
                timings.Add(value);
        }

        return timings;
    }

    private static bool TryParseTimingToken(string token, out double value)
    {
        value = 0;
        var trimmed = (token ?? "").Trim();
        if (trimmed.Length == 0)
            return false;

        // Support "25%" format.
        if (trimmed.EndsWith('%'))
        {
            var percentPart = trimmed.TrimEnd('%').Trim();
            if (double.TryParse(percentPart, NumberStyles.Float, CultureInfo.InvariantCulture, out var pct))
            {
                value = pct / 100.0;
                return true;
            }

            return false;
        }

        // Support MM:SS or HH:MM:SS (seconds can include decimals).
        if (TryParseClockTimestamp(trimmed, out var seconds))
        {
            value = seconds;
            return true;
        }

        if (double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var raw))
        {
            value = raw;
            return true;
        }

        // Fallback: parse first whitespace-delimited token if the line has notes.
        var firstToken = trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(firstToken) &&
            !string.Equals(firstToken, trimmed, StringComparison.Ordinal) &&
            TryParseTimingToken(firstToken, out var nested))
        {
            value = nested;
            return true;
        }

        return false;
    }

    private static bool TryParseClockTimestamp(string token, out double seconds)
    {
        seconds = 0;
        var trimmed = (token ?? "").Trim();
        if (trimmed.Length == 0 || !trimmed.Contains(':'))
            return false;

        var parts = trimmed.Split(':', StringSplitOptions.TrimEntries);
        if (parts.Length is < 2 or > 3 || parts.Any(string.IsNullOrWhiteSpace))
            return false;

        if (parts.Length == 2)
        {
            if (!int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var minutes) || minutes < 0)
                return false;
            if (!double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var sec) || sec < 0)
                return false;

            seconds = (minutes * 60.0) + sec;
            return true;
        }

        if (!int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var hours) || hours < 0)
            return false;
        if (!int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var mins) || mins < 0 || mins >= 60)
            return false;
        if (!double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var secs) || secs < 0 || secs >= 60)
            return false;

        seconds = (hours * 3600.0) + (mins * 60.0) + secs;
        return true;
    }

    private static List<double> CleanTimings(List<double> timings, int expectedCount, string? narration = null)
    {
        if (expectedCount <= 0)
            return new List<double>();

        if (timings.Count != expectedCount)
            return EvenTimings(expectedCount);

        var rawValues = new List<double>(expectedCount);
        foreach (var raw in timings)
        {
            if (!double.IsFinite(raw))
                return EvenTimings(expectedCount);
            rawValues.Add(raw);
        }

        var areFractions = rawValues.All(v => v is >= 0.0 and <= 1.0);
        if (areFractions)
        {
            var cleanedFractions = new List<double>(capacity: expectedCount);
            var prevFraction = -1.0;
            foreach (var raw in rawValues)
            {
                var v = Math.Clamp(raw, 0.0, 1.0);
                if (v <= prevFraction)
                    return EvenTimings(expectedCount);
                cleanedFractions.Add(v);
                prevFraction = v;
            }

            return cleanedFractions;
        }

        var absoluteSeconds = new List<double>(capacity: expectedCount);
        var prevSeconds = -1.0;
        foreach (var raw in rawValues)
        {
            var seconds = Math.Max(0.0, raw);
            if (seconds <= prevSeconds)
                return EvenTimings(expectedCount);
            absoluteSeconds.Add(seconds);
            prevSeconds = seconds;
        }

        var lastSeconds = absoluteSeconds[^1];
        if (lastSeconds <= 0)
            return EvenTimings(expectedCount);

        var estimatedNarrationSeconds = EstimateNarrationDurationSeconds(narration);
        var totalSeconds = Math.Max(lastSeconds + 1.0, estimatedNarrationSeconds);
        if (!double.IsFinite(totalSeconds) || totalSeconds <= 0)
            return EvenTimings(expectedCount);

        var cleaned = new List<double>(capacity: expectedCount);
        var prev = -1.0;
        foreach (var seconds in absoluteSeconds)
        {
            var v = Math.Clamp(seconds / totalSeconds, 0.0, 1.0);
            if (v <= prev)
                return EvenTimings(expectedCount);
            cleaned.Add(v);
            prev = v;
        }

        return cleaned;
    }

    private static List<double> CleanTimestampSeconds(List<double> rawTimings, int expectedCount, string? narration = null)
    {
        if (expectedCount <= 0)
            return new List<double>();

        if (rawTimings.Count != expectedCount)
            return new List<double>();

        var hasAbsoluteSeconds = rawTimings.Any(v => v > 1.0);
        if (!hasAbsoluteSeconds)
            return new List<double>();

        var cleaned = new List<double>(capacity: expectedCount);
        var prev = -1.0;
        foreach (var raw in rawTimings)
        {
            if (!double.IsFinite(raw))
                return new List<double>();

            var seconds = Math.Max(0.0, raw);
            if (seconds <= prev)
                return new List<double>();

            cleaned.Add(seconds);
            prev = seconds;
        }

        var estimatedNarrationSeconds = EstimateNarrationDurationSeconds(narration);
        if (estimatedNarrationSeconds > 0)
        {
            var lastTimestampSeconds = cleaned[^1];
            var maxAllowedSeconds = Math.Max(estimatedNarrationSeconds * 1.2, estimatedNarrationSeconds + 12.0);
            if (lastTimestampSeconds > maxAllowedSeconds)
                return new List<double>();
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

    private static double EstimateNarrationDurationSeconds(string? narration)
    {
        var text = (narration ?? "").Trim();
        if (text.Length == 0)
            return 0;

        var wordCount = CountWords(text);
        var byWords = wordCount > 0 ? wordCount / (145.0 / 60.0) : 0.0;
        var byChars = text.Length / 13.0;
        var pauseCount = text.Count(ch => ch is '.' or '!' or '?' or ';' or ':');
        var pauseSeconds = pauseCount * 0.18;
        var estimate = Math.Max(byWords, byChars * 0.9) + pauseSeconds;

        return Math.Clamp(estimate, 12.0, 60.0 * 60.0);
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
            .Take(24);

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

    private static string HumanizeNarration(string? narration)
    {
        var text = (narration ?? "").Replace("\r\n", "\n").Trim();
        if (text.Length == 0)
            return "";

        // Remove meta-action teacher cues so narration sounds natural.
        text = Regex.Replace(text,
            @"\b(?:now\s+)?(?:i(?:'m| am)|we(?:'re| are)|i(?:\s+will|'ll)|we(?:\s+will|'ll))\s+(?:just\s+)?(?:write|draw|put|note)\b[^.!?\n]*[.!?]?\s*",
            "",
            RegexOptions.IgnoreCase);
        text = Regex.Replace(text,
            @"\b(?:let(?:'s| us))\s+(?:write|draw|put|note)\b[^.!?\n]*[.!?]?\s*",
            "",
            RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bon the board\b[:,]?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b(?:let(?:'s| us)\s+pause|we(?:'re| are)\s+paused?|i(?:'m| am)\s+pausing|now\s+pausing)\b[^.!?\n]*[.!?]?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b(?:pause|paused)\b", "", RegexOptions.IgnoreCase);

        // Expand shorthand and symbols into spoken-language forms.
        text = Regex.Replace(text, @"\beqns?\b", m => m.Value.EndsWith("s", StringComparison.OrdinalIgnoreCase) ? "equations" : "equation", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bexs?\b", m => m.Value.EndsWith("s", StringComparison.OrdinalIgnoreCase) ? "examples" : "example", RegexOptions.IgnoreCase);
        text = text.Replace("<=", " less than or equal to ", StringComparison.Ordinal);
        text = text.Replace(">=", " greater than or equal to ", StringComparison.Ordinal);
        text = text.Replace("!=", " not equal to ", StringComparison.Ordinal);
        text = text.Replace("=>", " therefore ", StringComparison.Ordinal);
        text = text.Replace("->", " therefore ", StringComparison.Ordinal);
        text = text.Replace("^", " to the power of ", StringComparison.Ordinal);

        text = Regex.Replace(text, @"[ \t]{2,}", " ");
        text = Regex.Replace(text, @"\s+([,.;:!?])", "$1");
        text = Regex.Replace(text, @"\n{3,}", "\n\n");

        return text.Trim();
    }

    private static int CountWords(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return 0;

        var count = 0;
        var inWord = false;
        foreach (var ch in text)
        {
            if (char.IsLetterOrDigit(ch))
            {
                if (!inWord)
                {
                    count++;
                    inWord = true;
                }
            }
            else
            {
                inWord = false;
            }
        }

        return count;
    }

    private static bool ContainsAny(string text, params string[] needles)
    {
        if (string.IsNullOrWhiteSpace(text) || needles is null || needles.Length == 0)
            return false;

        foreach (var n in needles)
        {
            if (!string.IsNullOrWhiteSpace(n) && text.Contains(n, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static bool IsDrawLine(string? line)
    {
        var s = (line ?? "").Trim();
        return s.StartsWith("DRAW:", StringComparison.OrdinalIgnoreCase)
            || s.StartsWith("DRAW ", StringComparison.OrdinalIgnoreCase)
            || s.StartsWith("DRAW-", StringComparison.OrdinalIgnoreCase);
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
