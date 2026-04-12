using System.Text.Json;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using AiTeacher.Models;
using Microsoft.Extensions.Options;

namespace AiTeacher.Services.Ai;

public sealed class AiTeacherService : IAiTeacherService
{
    private const int MaxStoredBoardLineCount = 56;
    private static readonly Regex NarrationWordRegex = new(@"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?", RegexOptions.Compiled);

    private readonly IAiChatClient _ai;
    private readonly AiOptions _options;

    public AiTeacherService(IAiChatClient ai, IOptions<AiOptions> options)
    {
        _ai = ai;
        _options = options.Value;
    }

    private bool UsesElevenLabsTts() =>
        string.Equals(_options.ResolveTtsProvider(), "ElevenLabs", StringComparison.OrdinalIgnoreCase);

    private string BuildConfiguredNarrationPromptRules()
    {
        if (!UsesElevenLabsTts())
            return "";

        return
            "- ElevenLabs spoken-transcript rule: write for a natural teacher performance, not a polished article or commercial voiceover.\n" +
            "- Break ideas into short sentences and short paragraphs so the speech breathes naturally.\n" +
            "- Use light conversational fillers only when they help the cadence, such as \"so\", \"okay\", \"right\", or \"now\". Do not overuse them.\n" +
            "- Ask occasional rhetorical questions when they make the explanation feel one-to-one and live.\n" +
            "- Use commas for short pauses and ellipses for longer pauses when a thought should land.\n" +
            "- Use line breaks between major shifts, takeaways, or emphasis changes.\n" +
            "- Prefer spoken teacher phrasing like \"Alright, so let's break this down\" over textbook-style opening sentences.\n" +
            "- Explain the simple idea first, then give the precise definition, formula, or formal step.\n" +
            "- Avoid long dense sentences, robotic repetition, and list-reading cadence.\n" +
            "- Example of the target cadence:\n" +
            "  Okay... so here's the idea.\n" +
            "  When you heat water, something interesting happens.\n" +
            "  It starts to move faster... right?\n";
    }

    private static string BuildBoardStylePromptRules() =>
        "- Board style: write like a real teacher's whiteboard, not like narration prose.\n" +
        "- Prefer equations, labels, definitions, key terms, arrows, short prompts, and step fragments.\n" +
        "- Keep function words light. Avoid writing full conversational sentences on the board when a short board cue will do.\n" +
        "- Good board lines: \"Photosynthesis\", \"Light + H2O + CO2\", \"m = 2, b = 1\", \"Substitute: x=4\", \"Check: 3(4)=12\".\n" +
        "- Bad board lines: \"Today we will learn about photosynthesis.\" or \"We divide both sides by 3 to isolate x.\"\n" +
        "- Better versions: \"Photosynthesis\", \"Divide by 3\", \"x = 4\".\n" +
        "- For verbal lessons, use keywords, evidence snippets, grammar labels, and contrast pairs instead of long sentences.\n";

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
        var normalizedTopic = topic.ToLowerInvariant();

        if (!IsOpenAiEnabled())
        {
            var isSystem = ContainsAny(normalizedTopic, "system", "systems");
            var isLinear = ContainsAny(normalizedTopic, "linear", "slope", "intercept");
            var isPercent = ContainsAny(normalizedTopic, "percent", "unit rate", "ratio", "proportion");
            var isTriangle = ContainsAny(normalizedTopic, "triangle", "triangles", "pythagorean");
            var isCalculus = ContainsAny(normalizedTopic, "derivative", "derivatives", "differentiate", "differentiation", "calculus", "limit", "limits", "integral", "integrals", "tangent line", "secant");
            var isGraphs = ContainsAny(normalizedTopic, "graph", "graphs", "plot", "plots", "table", "tables");

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
                else if (isLinear || isGraphs || isCalculus)
                {
                    shortNarration +=
                        isCalculus
                            ? "Core rule: a derivative measures instantaneous rate of change, which you can picture as the slope of a tangent line.\n" +
                              "Example: for three x squared, the derivative is six x.\n" +
                              "Quick check: evaluate the derivative at a point to get the slope there."
                            : "Core rule: slope-intercept form is y equals m x plus b, where m is slope and b is intercept.\n" +
                              "Example: y equals two x plus one crosses at 1 and rises 2 for every run of 1.\n" +
                              "Quick check: plug in a point to verify the equation.";
                    shortLines.AddRange(new[]
                    {
                        isCalculus ? "Derivative = slope at a point" : "Slope-intercept form: y = mx + b",
                        isCalculus ? "Example: f(x)=3x^2 -> f'(x)=6x" : "Example line: y = 2x + 1",
                        isCalculus ? "At x=2, slope = f'(2)=12" : "x=0 -> y=1",
                        isCalculus ? "Tangent slope comes from f'(x)" : "x=3 -> y=7",
                        isCalculus ? "Quick check: plug x into f'(x)" : "Quick check: substitute back"
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
                return RepairLessonSyncFallback(EnsureMathLessonHasVisuals(
                    new AiVideoPack(HumanizeNarration(shortNarration), shortBoard, EvenTimings(shortBoard.Count)),
                    topic,
                    length));
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
            else if (isLinear || isGraphs || isCalculus)
            {
                fallbackNarration +=
                    isCalculus
                        ? "\n\nCalculus/graph focus:\n" +
                          "Example A links derivative notation to slope on a graph.\n" +
                          "Example B evaluates a derivative at a point and interprets what that slope means.\n" +
                          "Then we do transfer practice by switching between formula, slope, and graph language."
                        : "\n\nLinear/graph focus:\n" +
                          "Example A links slope-intercept form to visual slope and intercept.\n" +
                          "Example B starts from points and builds the equation.\n" +
                          "Then we do transfer practice by switching between equation, table, and graph views.";
                fallbackLines.AddRange(new[]
                {
                    isCalculus ? "Derivative = slope of tangent line" : "Slope-intercept form: y = mx + b",
                    isCalculus ? "Example: f(x)=x^2, slope near x=2" : "Example line: y = 2x + 1",
                    isCalculus ? "Use f'(x) to measure instant change" : "Pick x: 0 -> y=1",
                    isCalculus ? "At x=2, slope = 4" : "Pick x: 3 -> y=7",
                    "DRAW: axes x=-2..8 y=-2..10",
                    "DRAW: line y=2x+1",
                    "DRAW: point (0,1) label=(0,1)",
                    "DRAW: point (3,7) label=(3,7)",
                    isCalculus
                        ? "Trap: derivative is slope, not y-value itself"
                        : "Trap: slope is rise/run, not just 'the bigger number'"
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
            return RepairLessonSyncFallback(EnsureMathLessonHasVisuals(
                new AiVideoPack(HumanizeNarration(fallbackNarration), fallbackBoard, EvenTimings(fallbackBoard.Count)),
                topic,
                length));
        }

        const string systemPrompt =
            "You are an expert SAT tutor who teaches like a real classroom teacher. " +
            "Write in a friendly spoken voice and include what to write on a whiteboard. " +
            "Anything you solve in narration must also appear on the board as explicit intermediate steps. " +
            "Avoid referencing copyrighted SAT questions. Return plain text only (no markdown).";

        var needsGraph = ContainsAny(normalizedTopic, "graph", "graphs", "plot", "plots", "table", "tables");
        var needsSystem = ContainsAny(normalizedTopic, "system", "systems");
        var needsLinear = ContainsAny(normalizedTopic, "linear", "slope", "intercept");
        var needsPercent = ContainsAny(normalizedTopic, "percent", "unit rate", "ratio", "proportion");
        var needsTriangle = ContainsAny(normalizedTopic, "triangle", "triangles", "pythagorean");
        var needsCalculus = ContainsAny(normalizedTopic, "derivative", "derivatives", "differentiate", "differentiation", "calculus", "limit", "limits", "integral", "integrals", "tangent line", "secant");
        var needsTrig = ContainsAny(normalizedTopic, "sine", "cosine", "tangent", "trigonometry")
            || ContainsToken(normalizedTopic, "sin", "cos", "tan", "trig", "sohcahtoa", "soh-cah-toa");
        if (needsCalculus)
            needsTrig = false;
        var needsCircle = ContainsAny(normalizedTopic, "circle", "circles", "radius", "diameter", "arc", "sector");
        var needsQuadratic = ContainsAny(normalizedTopic, "quadratic", "quadratics", "parabola", "parabolas", "polynomial", "polynomials", "factor", "factoring");
        var needsDataVisual = needsPercent || ContainsAny(normalizedTopic, "probability", "statistics", "mean", "median", "mode", "data", "distribution");
        var needsCoordinatePlot = needsSystem || needsLinear || needsGraph || needsQuadratic || needsCalculus
            || ContainsAny(normalizedTopic, "coordinate", "coordinates", "line", "lines");
        var requiresMathDiagram = IsLikelyMathTopic(normalizedTopic);
        var suggestedMathVisuals = BuildRequiredMathVisualLines(topic, allowGenericFallback: true);
        var hasSpecificMathVisualPlan = suggestedMathVisuals.Count > 0;
        var needsNonRightTriangleCounterexample = NeedsNonRightTriangleCounterexample(normalizedTopic);
        var isVerbalTopic =
            ContainsAny(normalizedTopic,
                "transition", "grammar", "punctuation", "vocab", "vocabulary",
                "reading", "writing", "rhetoric", "evidence", "inference",
                "tone", "sentence", "paragraph", "clause", "pronoun", "verb", "conjunction")
            && !requiresMathDiagram;

        var diagramRequirement =
            needsCalculus
                ? "- Diagram requirement (required): include a coordinate graph with a line or tangent-slope visual and point to the key point while explaining rate of change.\n" +
                  "  - DRAW: axes x=-5..5 y=-5..5\n" +
                  "  - DRAW: line y=2x+1\n" +
                  "  - DRAW: point (1,3) label=P\n" +
                  "  - DRAW: focus (1,3)\n"
                : needsTrig
                ? "- Diagram requirement (required): include a right-triangle trig diagram with angle θ and labeled opposite/adjacent/hypotenuse, and point to it while explaining.\n" +
                  "  - For a basic sin/cos/tan lesson, use only that right triangle unless the topic explicitly asks for a graph or unit circle.\n" +
                  "  - Do NOT add axes, a coordinate plane, or a circle for a basic trig-ratio lesson.\n" +
                  "  - DRAW: triangle right; legs opp,adj; hypotenuse hyp; angle θ\n" +
                  "  - DRAW: focus right angle\n" +
                  "  - DRAW: focus hyp\n"
                : needsTriangle
                    ? (needsNonRightTriangleCounterexample
                    ? "- Diagram requirement (required): use a non-right triangle counterexample and point to an angle that is not 90 degrees while explaining why the Pythagorean theorem does not apply.\n" +
                      "  - Do NOT draw a right triangle for this explanation.\n" +
                      "  - DRAW: triangle id=t1 angles 50 60 70; angle 60°\n" +
                      "  - DRAW: focus triangle angle\n"
                    : "- Diagram requirement (required): include a right-triangle diagram AND point at it while explaining.\n" +
                      "  - DRAW: triangle right; legs a,b; hypotenuse c\n" +
                      "  - DRAW: focus hyp\n")
                : needsCircle
                    ? "- Diagram requirement (required): include a circle-style geometry diagram AND point to a key location while explaining.\n" +
                      "  - DRAW: circle id=c1 center=(0,0) r=3\n" +
                      "  - DRAW: point (3,0) label=r=3\n" +
                      "  - DRAW: focus (3,0)\n"
                : needsDataVisual
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
                        : needsCoordinatePlot
                            ? "- Diagram requirement (required): include a coordinate graph of your worked example line AND point to a key point.\n" +
                              "  - DRAW: axes x=-5..5 y=-5..5\n" +
                              "  - DRAW: line y=2x+1\n" +
                              "  - DRAW: point (0,1) label=(0,1)\n" +
                              "  - DRAW: focus (0,1)\n"
                            : hasSpecificMathVisualPlan
                                ? "- Diagram requirement: if you include a visual, it must directly match the concept you are explaining. Do NOT swap in a generic graph or unrelated shape.\n" +
                                  string.Concat(suggestedMathVisuals.Take(4).Select(line => $"  - {line}\n"))
                            : "";

        var drawPolicy =
            hasSpecificMathVisualPlan
                ? "- Draw policy: this topic has a clear matching visual, so include that DRAW-based explanation before the first major worked example, not just text.\n"
                : isVerbalTopic
                    ? "- Draw policy: this is a verbal/non-quantitative topic. DO NOT use any DRAW lines, plots, graphs, or geometric shapes. Use text-only whiteboard lines.\n"
                    : requiresMathDiagram
                        ? "- Draw policy: use DRAW lines only when the visual directly matches the explanation. Do NOT add a generic graph, triangle, or shape just because the topic is math.\n"
                        : "- Draw policy: use DRAW lines only if absolutely necessary; otherwise keep whiteboard text-only.\n";
        var trigDrawGuard =
            needsTrig
                ? "- For a standard trig-ratio lesson, keep the visual to one right triangle. Do NOT add axes, coordinate planes, or circles unless the topic explicitly asks for the unit circle or a graph.\n"
                : "";

        var drawUsageRules =
            hasSpecificMathVisualPlan
                ? "- If you use DRAW steps, explicitly switch between the text board and the diagram (e.g., \"On the left...\" then \"On the graph...\").\n" +
                  "- Use the diagram to teach the core idea before example-only solving begins.\n" +
                  "- Do not make the lesson example-only; include a visual intuition block first, then worked examples.\n" +
                  "- Interleave: go back-and-forth between text steps and diagram steps (don't dump all DRAW lines at the end).\n" +
                  "- If you include a diagram, include at least 2 \"DRAW: focus ...\" lines at different moments to point while you explain.\n" +
                  "- The diagram panel shows ONE diagram at a time. If you switch to a new diagram (axes/bar/triangle), add \"DRAW: clear\" first.\n" +
                  "- If a later example needs a different kind of visual, erase the old one with \"DRAW: clear\" and draw the new one. That is preferred over stacking unrelated visuals together.\n" +
                  "- Only use \"DRAW: focus ...\" on something you already drew earlier (or draw it immediately before focusing).\n" +
                  "- If you say \"plot\" or mention specific points/lines/bars in text, include matching DRAW commands (e.g., \"DRAW: point (1,2) label=P\").\n" +
                  "- If you want to update a shape later, give it an id and reuse it (e.g., triangle id=t1 ... then triangle id=t1 angles ...).\n" +
                  "- Supported DRAW commands only: axes, line, point, circle, square, bar, triangle, focus, move, clear.\n" +
                  "- Do NOT emit unsupported DRAW shorthand like \"DRAW: right triangle\", \"DRAW: graph\", \"DRAW: segment\", \"DRAW: rect\", or \"DRAW: arrow\".\n"
                : isVerbalTopic
                    ? "- Do not emit any line beginning with \"DRAW:\".\n"
                    : requiresMathDiagram
                        ? "- If you use DRAW steps, they must directly match the concept or example being explained. Skip visuals instead of drawing a generic graph or unrelated shape.\n"
                    : "- If you use DRAW steps, use at most 1-2 simple DRAW lines and only when they clearly improve understanding.\n";

        var optionalDrawExamples =
            hasSpecificMathVisualPlan
                ? "- Topic-matching DRAW lines you can reuse or adapt:\n" +
                  string.Concat(suggestedMathVisuals.Select(line => $"  - {line}\n"))
                : "";

        var lessonDurationLabel = isShortLesson ? "~3-5 minute" : "~12-18 minute";
        var narrationLengthRequirement = isShortLesson
            ? "- Narration length: roughly 420-700 words (about 3-5 minutes at 1.0x). Keep it concise and complete.\n"
            : "- Narration length: MUST be long-form, roughly 1700-2500 words (about 12-18 minutes at 1.0x). Do not return a short script.\n";
        var narrationContentRequirement = isShortLesson
            ? "- Narration: start with a 1-sentence hook, teach with at least 2 worked examples, include a 2-question quick check + fully worked solutions, and end with 3 takeaways + 3 common mistakes.\n"
            : "- Narration: start with a 1-sentence hook, teach with at least 6 worked examples, include a 5-question mini-quiz + fully worked solutions, end with 5 takeaways + 5 common mistakes.\n";
        var whiteboardSizeRequirement = isShortLesson
            ? "- Whiteboard: 14-24 total lines (including DRAW), max ~56 chars for text lines, using ASCII-friendly math for equations (no LaTeX). Standard symbols like θ are allowed in diagram labels.\n"
            : "- Whiteboard: 30-48 total lines (including DRAW), max ~56 chars for text lines, using ASCII-friendly math for equations (no LaTeX). Standard symbols like θ are allowed in diagram labels.\n";
        var boardContentRequirement = isShortLesson
            ? "- Include core teaching content on board: key rule/formula, worked-example prompts, quick-check questions, full worked solutions, and final checks.\n"
            : "- Include core teaching content on board: key rule/formula, worked-example prompts, mini-quiz questions, full worked solutions, and final checks.\n";
        var boardCoverageRequirement = isShortLesson
            ? "- Board coverage requirement: for each worked example and quick-check question, write the full board solution flow with all major algebra/logic transformations (setup -> equation steps -> simplification -> final answer -> check).\n"
            : "- Board coverage requirement: for each worked example and mini-quiz question, write the full board solution flow with all major algebra/logic transformations (setup -> equation steps -> simplification -> final answer -> check).\n";
        var configuredNarrationRules = BuildConfiguredNarrationPromptRules();

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
            configuredNarrationRules +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            drawPolicy +
            trigDrawGuard +
            whiteboardSizeRequirement +
            BuildBoardStylePromptRules() +
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
            "- Diagram label style: use standard symbols when appropriate (for example, use θ instead of the word theta).\n" +
            drawUsageRules +
            diagramRequirement +
            optionalDrawExamples +
            "- For DRAW lines, keep the command syntax plain text (use '-' not '−') and keep commands short. Standard symbols like θ are allowed in labels.\n" +
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

        if (hasSpecificMathVisualPlan)
        {
            for (var attempt = 0; attempt < 2 && NeedsMathVisualRewrite(pack, length); attempt++)
            {
                var minDrawCount = isShortLesson ? 2 : 4;
                var minFocusCount = isShortLesson ? 1 : 2;
                var suggestedVisuals = suggestedMathVisuals;
                var visualRetryPrompt = userPrompt +
                    "\nCRITICAL VISUAL ENFORCEMENT:\n" +
                    "- Prior draft did not use visuals strongly enough for a math lesson.\n" +
                    $"- Include at least {minDrawCount} DRAW lines interleaved through the lesson.\n" +
                    $"- Include at least {minFocusCount} DRAW: focus lines at different moments.\n" +
                    "- Put a visual intuition block before the first major worked example.\n" +
                    "- Narration must explicitly explain what the diagram/graph/shape shows during those beats.\n" +
                    "- Do not make the lesson example-only. Teach the concept visually first, then work examples.\n" +
                    "- For a custom math topic, choose the most helpful visual automatically (triangle, axes/graph, bar model, circle, shape, or other simple diagram).\n" +
                    "- Keep the same output format and keep SPOKEN_LINES/WHITEBOARD/TIMINGS counts aligned.\n" +
                    (suggestedVisuals.Count == 0
                        ? ""
                        : "Suggested visual lines for this topic:\n" + string.Join('\n', suggestedVisuals.Select(line => $"- {line}")) + "\n") +
                    "\nCurrent draft:\n" +
                    "NARRATION:\n" + pack.Narration + "\n\n" +
                    "SPOKEN_LINES:\n" + string.Join('\n', (pack.NarrationSegments ?? new List<string>()).Select(line => $"- {line}")) + "\n\n" +
                    "WHITEBOARD:\n" + string.Join('\n', (pack.BoardLines ?? new List<string>()).Select(line => $"- {line}")) + "\n\n" +
                    "TIMINGS:\n" + string.Join('\n', (pack.BoardTimings ?? new List<double>()).Select(value => $"- {value:0.###}"));

                text = await _ai.CompleteAsync(systemPrompt, visualRetryPrompt, ct);
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
        else
        {
            pack = EnsureMathLessonHasVisuals(pack, topic, length);
        }

        pack = await RepairGeneratedBoardAlignmentAsync(pack, ct);
        pack = await EnsureLessonBeatSyncAsync(topic, length, pack, ct);
        pack = RepairLessonSyncFallback(pack);
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
            BuildConfiguredNarrationPromptRules() +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            "- Whiteboard: 14–28 short lines, max ~56 characters each, showing full solution steps from setup to final answer/check.\n" +
            BuildBoardStylePromptRules() +
            "- Board completeness rule: write every material step on the board. If narration performs a setup, elimination, substitution, transformation, simplification, or check, put that move on its own board line.\n" +
            "- Omit only filler transition phrases; when deciding between brevity and completeness, prefer writing the step.\n" +
            "- Depth requirement: write full chain-of-work on the board, including key intermediate transformations (not just first and last line).\n" +
            "- Do not collapse multiple algebra or logic moves into one board line just to save space.\n" +
            "- For multiple-choice elimination, write why each eliminated option fails when relevant.\n" +
            "- Narration must explain each non-DRAW board line at the same moment, but in natural spoken language (do not read symbols or shorthand literally).\n" +
            "- SPOKEN_LINES: include exactly one spoken line per whiteboard line, in the same order and same count.\n" +
            "- Each spoken line should sound like a human teacher beat that matches that board step.\n" +
            "- Spoken style rule: expand shorthand and symbols when speaking (e.g., 'ex' -> 'example', 'eqn' -> 'equation', '->' -> 'therefore', '^' -> 'to the power of').\n" +
            "- Diagram label style: use standard symbols when appropriate (for example, use θ instead of the word theta).\n" +
            "- Optional diagrams: if a quick graph/diagram helps, include 1–3 WHITEBOARD lines starting with \"DRAW:\" (still counted as lines and need timings). Use simple commands like:\n" +
            "  - DRAW: axes x=-5..5 y=-5..5\n" +
            "  - DRAW: line y=2x+1\n" +
            "  - DRAW: point (3,7) label=(3,7)\n" +
            "  - DRAW: bar A=2 B=5 C=3\n" +
            "  - DRAW: triangle right 3 4 5\n" +
            "  - DRAW: triangle right; legs a,b; hypotenuse c\n" +
            "  - DRAW: triangle right; legs opp,adj; hypotenuse hyp; angle θ\n" +
            "  - DRAW: circle id=c1 center=(0,0) r=3\n" +
            "  - DRAW: square id=s1 center=(2,2) size=2 angle=20\n" +
            "  - DRAW: move id=s1 x=1 y=2\n" +
            "- If you update/reuse a shape, include a stable id= in those DRAW lines.\n" +
            "- For DRAW lines, keep the command syntax plain text (use '-' not '−') and keep commands short. Standard symbols like θ are allowed in labels.\n" +
            "- Use ASCII-friendly math for equations (no LaTeX). Standard symbols like θ are allowed in diagram labels.\n" +
            "- Timings: one timestamp per whiteboard line (same count), strictly increasing, format MM:SS (or HH:MM:SS).\n" +
            "- Each timestamp is when that line should START being written from narration start time.\n" +
            "- Narration length: roughly 450-700 words so the full reasoning is explained clearly.\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        return ParseVideoPack(text, fallbackBoardHeader: "Solution steps:");
    }

    public async Task<AiVideoPack> AnswerVideoQuestionAsync(VideoJob video, string question, double? progress, VideoQuestionBoardRequest? board, CancellationToken ct)
    {
        var q = (question ?? "").Trim();
        if (string.IsNullOrWhiteSpace(q))
            return new AiVideoPack("", new List<string>(), new List<double>());

        var studentBoardTextLines = CleanBoardLines(ParseBoardLines(board?.WrittenContent ?? ""));
        var studentDrawCommands = CleanStudentDrawCommands(board?.DrawCommands);
        var hasStudentBoardText = studentBoardTextLines.Count > 0;
        var hasStudentDrawCommands = studentDrawCommands.Count > 0;

        if (!IsOpenAiEnabled())
        {
            var fallbackNarration =
                "Great question. Let me answer it clearly.\n\n" +
                "AI isn't configured yet, so I can't generate a real-time answer.\n" +
                "Set Ai__OpenAi__ApiKey or OPENAI_API_KEY, then try again.\n\n" +
                "Alright—now let's jump back into the lesson.";

            var header = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";
            var fallbackBoard = CleanBoardLines(new[] { header, "Enable OpenAI to answer." });
            return new AiVideoPack(HumanizeNarration(fallbackNarration), fallbackBoard, EvenTimings(fallbackBoard.Count));
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
        var visualTopic = BuildVideoQuestionVisualContext(video, q, recentLines, script, studentBoardTextLines, studentDrawCommands);
        var suggestedQuestionVisuals = BuildRequiredMathVisualLines(visualTopic);
        var shouldForceVisuals = hasStudentDrawCommands || suggestedQuestionVisuals.Count > 0;

        const string systemPrompt =
            "You are an expert SAT tutor teaching like a real classroom teacher. " +
            "A student asked a question during the lesson, and you will answer it, then smoothly return to the lesson. " +
            "Be friendly, natural, and step-by-step when helpful. " +
            "Anything you solve in narration must also appear on the board as explicit intermediate steps. " +
            "Use plain text only (no markdown). " +
            "Avoid referencing copyrighted SAT questions.";

        var headerLine = CleanBoardLines(new[] { $"Q: {q}" }).FirstOrDefault() ?? "Q:";
        var drawGuidance = hasStudentDrawCommands
            ? "- The student supplied visuals as context only; they are NOT automatically visible in the answer playback unless you include matching WHITEBOARD DRAW lines.\n" +
              "- Recreate the relevant student visual exactly once when you first need it, then reuse that same visual with focus or update commands instead of drawing a second duplicate copy.\n" +
              "- Include at least 2 WHITEBOARD lines starting with \"DRAW:\" that recreate, reuse, or extend that same setup, and include at least 1 \"DRAW: focus ...\" line when it helps point to the key feature.\n"
            : shouldForceVisuals
            ? "- This question has a clear matching visual. Include at least 2 WHITEBOARD lines starting with \"DRAW:\" and at least 1 \"DRAW: focus ...\" line, but only if they match the explanation exactly.\n" +
              "- Do NOT substitute a default graph, triangle, or shape that contradicts the answer.\n"
            : IsLikelyMathTopic(visualTopic)
                ? "- Optional diagrams: use 1–2 WHITEBOARD lines starting with \"DRAW:\" only if they directly match the explanation. Do NOT add a generic graph, triangle, or shape just because the question is math.\n"
                : "- Optional diagrams: if it helps, include 1–2 WHITEBOARD lines starting with \"DRAW:\" (still counted as lines and need timings).\n";
        var suggestedQuestionVisualBlock = suggestedQuestionVisuals.Count == 0
            ? ""
            : "- Matching visual examples for this question:\n" +
              string.Concat(suggestedQuestionVisuals.Take(4).Select(line => $"  - {line}\n"));
        var studentBoardPromptBlock = BuildStudentQuestionBoardPromptBlock(studentBoardTextLines, studentDrawCommands);
        var studentBoardRequirement = hasStudentDrawCommands
            ? "- Treat the student's submitted visual as context, not as already rendered. Recreate it once with matching measurements and labels when it becomes relevant, then reuse that same shape with focus or update commands.\n" +
              "- Do not invent a second copy of the same triangle, graph, or shape unless you are explicitly correcting an error.\n"
            : hasStudentBoardText
                ? "- The student already wrote key notes on the board. Answer that exact written setup instead of replacing it with a different problem.\n"
                : "";

        var userPrompt =
            $"Video title: {video.Title}\n" +
            $"Video type: {video.SourceType}\n" +
            (clampedProgress is null ? "" : $"Lesson position: ~{(int)Math.Round(clampedProgress.Value * 100)}% of the lesson\n") +
            (recentLines.Count == 0 ? "" : $"Whiteboard so far (most recent):\n- {string.Join("\n- ", recentLines)}\n") +
            "\nLesson narration (context):\n" +
            (string.IsNullOrWhiteSpace(script) ? "(No script available.)" : script) +
            studentBoardPromptBlock +
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
            BuildConfiguredNarrationPromptRules() +
            "- Do NOT use meta-action narration like \"now I'm writing\" or \"now I'm drawing\". Just explain the content directly while board lines appear.\n" +
            "- Do NOT mention pausing/resuming playback. Avoid words like \"pause\" or \"paused\" in narration.\n" +
            $"- Whiteboard: 6–14 short lines, max ~56 characters each. First line MUST be exactly: {headerLine}\n" +
            BuildBoardStylePromptRules() +
            "- Do not restate the full question again on later board lines. After the required first Q: line, use the remaining board space for the actual explanation.\n" +
            "- Board completeness rule: write every material step on the board. If narration performs a setup, substitution, transformation, simplification, or check, put that move on its own board line.\n" +
            "- Omit only filler transition phrases; when deciding between brevity and completeness, prefer writing the step.\n" +
            "- Do not collapse multiple algebra or logic moves into one board line just to save space.\n" +
            studentBoardRequirement +
            "- Narration must explain each non-DRAW board line at the same moment, but in natural spoken language (do not read symbols or shorthand literally).\n" +
            "- SPOKEN_LINES: include exactly one spoken line per whiteboard line, in the same order and same count.\n" +
            "- Each spoken line should sound like a brief real-teacher beat tied to that one board step.\n" +
            "- Spoken style rule: expand shorthand and symbols when speaking (e.g., 'ex' -> 'example', 'eqn' -> 'equation', '->' -> 'therefore', '^' -> 'to the power of').\n" +
            "- Diagram label style: use standard symbols when appropriate (for example, use θ instead of the word theta).\n" +
            "- Use ASCII-friendly math for equations (no LaTeX). Standard symbols like θ are allowed in diagram labels.\n" +
            drawGuidance +
            suggestedQuestionVisualBlock +
            "- You may use shape ids to update a prior shape, e.g., \"DRAW: circle id=c1 ...\" then \"DRAW: move id=c1 x=... y=...\".\n" +
            "- For DRAW lines, keep the command syntax plain text (use '-' not '−') and keep commands short. Standard symbols like θ are allowed in labels.\n" +
            "- Timings: one timestamp per whiteboard line (same count), strictly increasing, format MM:SS (or HH:MM:SS).\n";

        var text = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var pack = ParseVideoPack(text, fallbackBoardHeader: headerLine);
        if (hasStudentDrawCommands)
            pack = EnsureStudentQuestionHasVisuals(pack, studentDrawCommands, headerLine);
        else if (shouldForceVisuals)
            pack = EnsureMathLessonHasVisuals(pack, visualTopic, LessonLength.Short, allowGenericFallback: false);
        pack = await RepairGeneratedBoardAlignmentAsync(pack, ct);

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
        _options.UseOpenAi();

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

            var boardLines = PolishGeneratedBoardLines(CleanBoardLines(ParseBoardLines(boardText)));
            var narrationSegments = CleanNarrationSegments(ParseBoardLines(spokenLinesText));
            if (narrationSegments.Count != boardLines.Count)
                narrationSegments = new List<string>();

            boardLines = PolishGeneratedBoardLines(boardLines, narrationSegments);

            var narration = BuildNarrationFromSegments(narrationSegments, narrationText);
            if (boardLines.Count == 0)
                boardLines = PolishGeneratedBoardLines(CleanBoardLines(DeriveBoardLines(narration)));

            var rawTimings = ParseTimings(timingsText);
            var timings = CleanTimings(rawTimings, boardLines.Count, narration);
            var timestampSeconds = CleanTimestampSeconds(rawTimings, boardLines.Count, narration);
            return new AiVideoPack(narration, boardLines, timings, timestampSeconds, narrationSegments);
        }

        // Fallback if the model didn't follow the format.
        var fallbackLines = new List<string> { fallbackBoardHeader };
        fallbackLines.AddRange(DeriveBoardLines(normalized));
        var cleanedBoard = PolishGeneratedBoardLines(CleanBoardLines(fallbackLines));
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

            // Allow long text lines to wrap naturally on the canvas instead of clipping them mid-sentence.
            var isDraw =
                line.StartsWith("DRAW:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("DRAW ", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("DRAW-", StringComparison.OrdinalIgnoreCase);
            if (isDraw)
                line = CanonicalizeDrawLine(line);
            var maxChars = isDraw ? 220 : 480;
            if (line.Length > maxChars)
                line = line.Substring(0, maxChars).TrimEnd();

            cleaned.Add(line);

            if (cleaned.Count >= MaxStoredBoardLineCount)
                break;
        }

        return cleaned;
    }

    private static string CanonicalizeDrawLine(string line)
    {
        var raw = (line ?? "").Trim();
        if (raw.Length == 0)
            return raw;

        var command = raw
            .Replace("DRAW:", "", StringComparison.OrdinalIgnoreCase)
            .Replace("DRAW ", "", StringComparison.OrdinalIgnoreCase)
            .Replace("DRAW-", "", StringComparison.OrdinalIgnoreCase)
            .Trim();
        if (command.Length == 0)
            return "DRAW:";

        if (Regex.IsMatch(command, @"^right\s+triangle\b", RegexOptions.IgnoreCase))
        {
            var suffix = Regex.Replace(command, @"^right\s+triangle\b", "", RegexOptions.IgnoreCase).Trim();
            command = CanonicalizeTriangleCommand(command, suffix);
        }
        else if (Regex.IsMatch(command, @"^triangle\s+right\b", RegexOptions.IgnoreCase))
        {
            var suffix = Regex.Replace(command, @"^triangle\s+right\b", "", RegexOptions.IgnoreCase).Trim();
            command = CanonicalizeTriangleCommand(command, suffix);
        }
        else if (Regex.IsMatch(command, @"^(triangle)\s*$", RegexOptions.IgnoreCase))
        {
            command = "triangle right; legs a,b; hypotenuse c";
        }
        else if (Regex.IsMatch(command, @"^(graph|coordinate graph|coordinate plane|plane|grid|axes)\s*$", RegexOptions.IgnoreCase))
        {
            command = "axes x=-5..5 y=-5..5";
        }
        else if (Regex.IsMatch(command, @"^(bar chart|bar graph)\s*$", RegexOptions.IgnoreCase))
        {
            command = "bar A=2 B=5 C=3";
        }
        else if (Regex.IsMatch(command, @"^focus\s+hyp(?:otenuse)?\s*$", RegexOptions.IgnoreCase))
        {
            command = "focus triangle hyp";
        }
        else if (Regex.IsMatch(command, @"^focus\s+right\s+angle\s*$", RegexOptions.IgnoreCase))
        {
            command = "focus triangle right angle";
        }
        else if (Regex.IsMatch(command, @"^focus\s+right\s+angle(?:\s+box)?\s*$", RegexOptions.IgnoreCase))
        {
            command = "focus triangle right angle";
        }
        else if (Regex.IsMatch(command, @"^focus\s+opp(?:osite)?\s*$", RegexOptions.IgnoreCase))
        {
            command = "focus triangle opp";
        }
        else if (Regex.IsMatch(command, @"^focus\s+adj(?:acent)?\s*$", RegexOptions.IgnoreCase))
        {
            command = "focus triangle adj";
        }
        else if (Regex.IsMatch(command, @"^(?:highlight|circle)\b.*\bhyp(?:otenuse)?\b", RegexOptions.IgnoreCase))
        {
            command = "focus triangle hyp";
        }
        else if (Regex.IsMatch(command, @"^highlight\b.*\bright\s+angle\b", RegexOptions.IgnoreCase))
        {
            command = "focus triangle right angle";
        }
        else if (Regex.IsMatch(command, @"^label\s+sides?\s+relative\s+to\s+theta\b", RegexOptions.IgnoreCase))
        {
            command = "triangle right; legs opp,adj; hypotenuse hyp; angle θ";
        }
        else if (Regex.IsMatch(command, @"^circle\b", RegexOptions.IgnoreCase) && !HasExplicitCircleGeometry(command))
        {
            command = CanonicalizeTrigFocusCommand(command) ?? command;
        }

        return $"DRAW: {command}";
    }

    private static string CanonicalizeTriangleCommand(string originalCommand, string suffix)
    {
        var fallback = suffix.Length == 0
            ? "triangle right; legs a,b; hypotenuse c"
            : $"triangle right; {suffix.TrimStart(':', ';', '-', ' ')}";

        return LooksLikeTrigTriangleDraw(originalCommand) && !HasExplicitTriangleLabels(originalCommand)
            ? "triangle right; legs opp,adj; hypotenuse hyp; angle θ"
            : fallback;
    }

    private static bool LooksLikeTrigTriangleDraw(string command) =>
        Regex.IsMatch(command ?? "", @"\b(?:theta|acute angle|opp(?:osite)?|adj(?:acent)?|hyp(?:otenuse)?)\b|θ", RegexOptions.IgnoreCase);

    private static bool HasExplicitTriangleLabels(string command) =>
        Regex.IsMatch(command ?? "", @"\blegs?\s*[:=]?\s*[^\s,;/]+\s*[,/]\s*[^\s,;/]+", RegexOptions.IgnoreCase) ||
        Regex.IsMatch(command ?? "", @"\bhyp(?:otenuse)?\s*[:=]?\s*[^\s,;]+", RegexOptions.IgnoreCase);

    private static bool HasExplicitCircleGeometry(string command) =>
        Regex.IsMatch(command ?? "", @"\b(?:center|radius|r|start|end|from|to)\s*[:=]", RegexOptions.IgnoreCase) ||
        Regex.IsMatch(command ?? "", @"\(\s*[^,]+\s*,\s*[^)]+\s*\)");

    private static string? CanonicalizeTrigFocusCommand(string command)
    {
        if (!LooksLikeTrigTriangleDraw(command))
            return null;

        if (Regex.IsMatch(command, @"\bright\s+angle\b", RegexOptions.IgnoreCase))
            return "focus triangle right angle";
        if (Regex.IsMatch(command, @"\bhyp(?:otenuse)?\b", RegexOptions.IgnoreCase))
            return "focus triangle hyp";
        if (Regex.IsMatch(command, @"\bopp(?:osite)?\b", RegexOptions.IgnoreCase))
            return "focus triangle opp";
        if (Regex.IsMatch(command, @"\badj(?:acent)?\b", RegexOptions.IgnoreCase))
            return "focus triangle adj";
        if (Regex.IsMatch(command, @"\btheta\b|θ", RegexOptions.IgnoreCase))
            return "focus triangle θ";

        return null;
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

    private static AiVideoPack RepairLessonSyncFallback(AiVideoPack pack)
    {
        var narration = HumanizeNarration(pack.Narration);
        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var narrationSegments = CleanNarrationSegments(pack.NarrationSegments ?? new List<string>());

        if (boardLines.Count == 0 && narrationSegments.Count > 0)
            boardLines = BuildBoardLinesFromNarrationSegments(Array.Empty<string>(), narrationSegments);
        if (boardLines.Count == 0 && narration.Length > 0)
            boardLines = CleanBoardLines(DeriveBoardLines(narration));
        if (boardLines.Count == 0)
            return new AiVideoPack(narration, new List<string>(), new List<double>());

        var hasAlignedSegments =
            narrationSegments.Count == boardLines.Count &&
            !HasWeakBoardNarrationAlignment(boardLines, narrationSegments);

        if (hasAlignedSegments)
        {
            var lockedNarration = BuildNarrationFromSegments(narrationSegments, narration);
            var lockedTimings = BuildNarrationSegmentTimings(narrationSegments);
            return new AiVideoPack(lockedNarration, boardLines, lockedTimings, new List<double>(), narrationSegments);
        }

        if (!hasAlignedSegments)
        {
            var fallbackSegments =
                narrationSegments.Count == boardLines.Count
                    ? narrationSegments
                    : SplitNarrationIntoBoardSegments(narration, boardLines.Count);

            if (fallbackSegments.Count == boardLines.Count)
            {
                var repairedBoard = BuildBoardLinesFromNarrationSegments(boardLines, fallbackSegments);
                if (repairedBoard.Count == boardLines.Count &&
                    !HasWeakBoardNarrationAlignment(repairedBoard, fallbackSegments))
                {
                    return new AiVideoPack(
                        narration,
                        repairedBoard,
                        EvenTimings(repairedBoard.Count),
                        new List<double>(),
                        fallbackSegments);
                }
            }
        }

        return BuildGuaranteedBoardAnchoredLessonPack(narration, boardLines, narrationSegments);
    }

    private static AiVideoPack BuildGuaranteedBoardAnchoredLessonPack(
        string narration,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<string> existingSegments)
    {
        var lockedBoard = CleanBoardLines(boardLines);
        if (lockedBoard.Count == 0)
            return new AiVideoPack(HumanizeNarration(narration), new List<string>(), new List<double>());

        var guaranteedSegments = BuildGuaranteedNarrationSegments(narration, lockedBoard, existingSegments);
        if (guaranteedSegments.Count != lockedBoard.Count)
            guaranteedSegments = lockedBoard
                .Select((line, index) => BuildBoardAnchoredNarrationSegment(line, index, lockedBoard.Count))
                .ToList();

        var lockedNarration = BuildNarrationFromSegments(guaranteedSegments, narration);
        var lockedTimings = BuildNarrationSegmentTimings(guaranteedSegments);
        return new AiVideoPack(lockedNarration, lockedBoard.ToList(), lockedTimings, new List<double>(), guaranteedSegments);
    }

    private static List<string> BuildGuaranteedNarrationSegments(
        string narration,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<string> existingSegments)
    {
        if (boardLines.Count == 0)
            return new List<string>();

        return boardLines
            .Select((line, index) => BuildBoardAnchoredNarrationSegment(line, index, boardLines.Count))
            .ToList();
    }

    private static List<double> BuildNarrationSegmentTimings(IReadOnlyList<string> narrationSegments)
    {
        if (narrationSegments.Count == 0)
            return new List<double>();

        if (narrationSegments.Count == 1)
            return new List<double> { 0.18 };

        const double start = 0.12;
        const double end = 0.92;
        var weights = narrationSegments
            .Select(EstimateNarrationSegmentWeight)
            .ToList();
        var totalWeight = Math.Max(1.0, weights.Sum());
        var timings = new List<double>(narrationSegments.Count);
        var cumulative = 0.0;

        for (var i = 0; i < narrationSegments.Count; i++)
        {
            var fraction = start + ((end - start) * (cumulative / totalWeight));
            if (timings.Count > 0)
                fraction = Math.Max(fraction, timings[^1] + 0.015);
            timings.Add(Math.Min(end, fraction));
            cumulative += weights[i];
        }

        for (var i = 1; i < timings.Count; i++)
        {
            if (timings[i] <= timings[i - 1])
                timings[i] = Math.Min(end, timings[i - 1] + 0.015);
        }

        return CleanTimings(timings, narrationSegments.Count, BuildNarrationFromSegments(narrationSegments, ""));
    }

    private static double EstimateNarrationSegmentWeight(string? segment)
    {
        var text = (segment ?? "").Trim();
        if (text.Length == 0)
            return 1.0;

        var words = Math.Max(3, CountWords(text));
        var punctuation = text.Count(ch => ch is '.' or ',' or ';' or ':' or '!' or '?');
        return words + (punctuation * 0.35);
    }

    private static string BuildBoardAnchoredNarrationSegment(string boardLine, int index, int totalCount)
    {
        var line = (boardLine ?? "").Trim();
        if (line.Length == 0)
            return $"Step {index + 1}.";

        return IsDrawLine(line)
            ? BuildDrawNarrationSegment(line, index, totalCount)
            : BuildTextNarrationSegment(line, index, totalCount);
    }

    private static string BuildDrawNarrationSegment(string line, int index, int totalCount)
    {
        var canonical = CanonicalizeDrawLine(line);
        var command = canonical
            .Replace("DRAW:", "", StringComparison.OrdinalIgnoreCase)
            .Trim();
        var normalized = command.ToLowerInvariant();

        if (normalized.StartsWith("clear"))
            return "Clear the diagram so the next example starts with a clean visual.";

        if (normalized.StartsWith("axes"))
            return "Set up the coordinate axes so the graph is easy to read.";

        if (normalized.StartsWith("line "))
        {
            var expr = command.Substring("line".Length).Trim();
            return PunctuateSpokenSegment($"Plot the line {SpokenizeBoardText(expr)} on the graph");
        }

        if (normalized.StartsWith("point "))
        {
            var label = Regex.Match(command, @"label\s*[:=]\s*([^\s,;]+(?:\s*[^\s,;]+)*)", RegexOptions.IgnoreCase).Groups[1].Value.Trim();
            var point = Regex.Match(command, @"\(([^)]+)\)").Groups[1].Value.Trim();
            var baseText = point.Length > 0
                ? $"Mark the point {point}"
                : "Mark that point on the graph";
            if (label.Length > 0)
                baseText += $" and label it {SpokenizeBoardText(label)}";
            return PunctuateSpokenSegment(baseText);
        }

        if (normalized.StartsWith("triangle "))
        {
            if (normalized.Contains("angles"))
            {
                var numbers = Regex.Matches(command, @"-?\d+(?:\.\d+)?")
                    .Select(match => match.Value)
                    .Take(3)
                    .ToList();
                if (numbers.Count >= 2)
                {
                    var angleList = string.Join(", ", numbers.Take(numbers.Count - 1)) +
                        (numbers.Count > 1 ? $" and {numbers[^1]}" : "");
                    return PunctuateSpokenSegment($"Sketch a triangle with angles {angleList} degrees");
                }
            }

            if (normalized.Contains("right"))
                return "Sketch a right triangle and label the important sides.";

            return "Sketch the triangle so we can refer to its sides and angles visually.";
        }

        if (normalized.StartsWith("bar "))
        {
            var bars = Regex.Matches(command, @"([A-Za-z0-9_]+)\s*[:=]\s*([^\s,;]+)")
                .Select(match => $"{match.Groups[1].Value} equals {match.Groups[2].Value}")
                .ToList();
            return bars.Count > 0
                ? PunctuateSpokenSegment($"Draw a bar chart with {string.Join(", ", bars)}")
                : "Draw the bar chart so the comparison is visible.";
        }

        if (normalized.StartsWith("circle "))
        {
            var center = Regex.Match(command, @"center\s*[:=]\s*(\([^)]+\))", RegexOptions.IgnoreCase).Groups[1].Value.Trim();
            var radius = Regex.Match(command, @"\b(?:r|radius)\s*[:=]\s*([^\s,;]+)", RegexOptions.IgnoreCase).Groups[1].Value.Trim();
            var phrase = "Draw the circle";
            if (center.Length > 0)
                phrase += $" centered at {center}";
            if (radius.Length > 0)
                phrase += $" with radius {SpokenizeBoardText(radius)}";
            return PunctuateSpokenSegment(phrase);
        }

        if (normalized.StartsWith("square "))
            return "Draw the square so we can reference its center, side, and corner.";

        if (normalized.StartsWith("move "))
            return "Move that shape to its new position on the diagram.";

        if (normalized.StartsWith("focus "))
        {
            var target = command.Substring("focus".Length).Trim();
            return BuildFocusNarrationSegment(target);
        }

        return "Use the diagram to highlight the key visual idea here.";
    }

    private static string BuildFocusNarrationSegment(string target)
    {
        var normalized = (target ?? "").Trim().ToLowerInvariant();
        if (normalized.Length == 0)
            return "Focus on the key part of the visual.";

        if (normalized.Contains("triangle right angle"))
            return "Focus on the right angle in the triangle because that is what makes this relationship work.";
        if (normalized.Contains("triangle hyp"))
            return "Focus on the hypotenuse of the triangle because that is the side across from the right angle.";
        if (normalized.Contains("triangle opp"))
            return "Focus on the opposite side of the triangle relative to the marked angle.";
        if (normalized.Contains("triangle adj"))
            return "Focus on the adjacent side of the triangle next to the marked angle.";
        if (normalized.Contains("triangle") && (normalized.Contains("theta") || normalized.Contains("angle")))
            return "Focus on the marked angle in the triangle because that is the angle we are reasoning about.";
        if (normalized.Contains("square corner"))
            return "Focus on the corner of the square so we can identify the vertex we need.";
        if (normalized.Contains("square side"))
            return "Focus on the side of the square because that edge is the quantity we will use.";
        if (normalized.Contains("square center"))
            return "Focus on the center of the square so the shape's position is clear.";
        if (normalized.Contains("circle center"))
            return "Focus on the center of the circle because the radius is measured from that point.";
        if (normalized.Contains("circle radius") || normalized.Contains("circle edge") || normalized.Contains("circle rim"))
            return "Focus on the radius of the circle because that distance controls the calculation.";
        if (normalized.Contains("bar "))
            return PunctuateSpokenSegment($"Focus on {SpokenizeBoardText(target)} because that is the bar we are comparing");
        if (normalized.Contains("line"))
            return "Focus on the line on the graph because it shows the relationship between the variables.";
        if (normalized.Contains("point"))
            return PunctuateSpokenSegment($"Focus on {SpokenizeBoardText(target)} because that point is the one we need");

        var point = Regex.Match(target ?? "", @"\(([^)]+)\)").Groups[1].Value.Trim();
        if (point.Length > 0)
            return PunctuateSpokenSegment($"Focus on the point {point} on the graph");

        return PunctuateSpokenSegment($"Focus on {SpokenizeBoardText(target)} because that is the key part of the visual");
    }

    private static string BuildTextNarrationSegment(string line, int index, int totalCount)
    {
        var text = (line ?? "").Trim();
        if (text.Length == 0)
            return $"Step {index + 1}.";

        if (text.StartsWith("TOPIC:", StringComparison.OrdinalIgnoreCase))
            return PunctuateSpokenSegment($"Today's topic is {SpokenizeBoardText(text["TOPIC:".Length..].Trim())}");

        if (Regex.IsMatch(text, @"^Q:\s*", RegexOptions.IgnoreCase))
            return PunctuateSpokenSegment($"The question is {SpokenizeBoardText(Regex.Replace(text, @"^Q:\s*", "", RegexOptions.IgnoreCase))}");

        if (Regex.IsMatch(text, @"^Ex\d+:", RegexOptions.IgnoreCase))
        {
            var expanded = Regex.Replace(text, @"^Ex(\d+):", "Example $1:", RegexOptions.IgnoreCase);
            return PunctuateSpokenSegment(SpokenizeBoardText(expanded));
        }

        if (Regex.IsMatch(text, @"^Check:", RegexOptions.IgnoreCase))
            return PunctuateSpokenSegment($"Check this carefully: {SpokenizeBoardText(Regex.Replace(text, @"^Check:\s*", "", RegexOptions.IgnoreCase))}");

        if (Regex.IsMatch(text, @"^Quick check:", RegexOptions.IgnoreCase))
            return PunctuateSpokenSegment($"Quick check: {SpokenizeBoardText(Regex.Replace(text, @"^Quick check:\s*", "", RegexOptions.IgnoreCase))}");

        if (Regex.IsMatch(text, @"^(Rule|Goal|Method|Takeaway|Trap|Answer|Solution):", RegexOptions.IgnoreCase))
            return PunctuateSpokenSegment(SpokenizeBoardText(text));

        var spoken = SpokenizeBoardText(text);
        if (Regex.IsMatch(text, @"[=<>+\-/*^]") || Regex.IsMatch(text, @"\b\d+\b"))
            return PunctuateSpokenSegment($"We get {spoken}");

        return PunctuateSpokenSegment(spoken);
    }

    private static string SpokenizeBoardText(string? raw)
    {
        var text = (raw ?? "").Trim();
        if (text.Length == 0)
            return "";

        text = Regex.Replace(text, @"\bEx(\d+)\b", "Example $1", RegexOptions.IgnoreCase);
        text = text.Replace("%", " percent", StringComparison.Ordinal);
        text = text.Replace("<=", " less than or equal to ", StringComparison.Ordinal);
        text = text.Replace(">=", " greater than or equal to ", StringComparison.Ordinal);
        text = text.Replace("!=", " not equal to ", StringComparison.Ordinal);
        text = text.Replace("->", " therefore ", StringComparison.Ordinal);
        text = Regex.Replace(text, @"\^2\b", " squared", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\^3\b", " cubed", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\^(\d+)", " to the power of $1", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"(?<=\S)/(?=\S)", " over ");
        text = Regex.Replace(text, @"(?<=\S)\+(?=\S)", " plus ");
        text = Regex.Replace(text, @"(?<=\S)=(?=\S)", " equals ");
        text = Regex.Replace(text, @"(?<=\S)<(?=\S)", " less than ");
        text = Regex.Replace(text, @"(?<=\S)>(?=\S)", " greater than ");
        text = Regex.Replace(text, @"(?<=[A-Za-z0-9)])-(?=[A-Za-z0-9(])", " minus ");
        text = Regex.Replace(text, @"(^|[=(,:]\s*)-(?=[A-Za-z0-9(])", "$1negative ");
        text = Regex.Replace(text, @"(\d)([A-Za-z])", "$1 $2");
        text = Regex.Replace(text, @"([A-Za-z])(\d)", "$1 $2");
        text = Regex.Replace(text, @"\s+", " ").Trim();
        return HumanizeNarration(text);
    }

    private static string PunctuateSpokenSegment(string? raw)
    {
        var text = HumanizeNarration(raw);
        if (text.Length == 0)
            return "";
        if (text.EndsWith('.') || text.EndsWith('!') || text.EndsWith('?'))
            return text;
        return text + ".";
    }

    private static List<string> SplitNarrationIntoBoardSegments(string narration, int segmentCount)
    {
        if (segmentCount <= 0)
            return new List<string>();

        var text = (narration ?? "").Trim();
        if (text.Length == 0)
            return new List<string>();

        if (segmentCount == 1)
            return new List<string> { text };

        var words = NarrationWordRegex.Matches(text)
            .Cast<Match>()
            .ToList();
        if (words.Count == 0)
            return new List<string>();

        var boundaries = new List<int>(segmentCount + 1) { 0 };
        var cursor = 0;
        for (var i = 0; i < segmentCount - 1; i++)
        {
            var remainingSegments = segmentCount - i;
            var remainingWords = words.Count - cursor;
            var take = (int)Math.Ceiling(remainingWords / (double)Math.Max(1, remainingSegments));
            cursor = Math.Min(words.Count - 1, cursor + take);

            var nextWordIndex = words[cursor].Index;
            var boundary = FindNarrationBoundaryNear(text, nextWordIndex);
            if (boundary <= boundaries[^1])
                boundary = nextWordIndex;

            boundaries.Add(boundary);
        }

        boundaries.Add(text.Length);

        var segments = new List<string>(segmentCount);
        for (var i = 0; i < segmentCount; i++)
        {
            var start = boundaries[i];
            var end = boundaries[i + 1];
            if (end <= start)
                end = Math.Min(text.Length, Math.Max(start + 1, start + (text.Length / Math.Max(1, segmentCount))));

            var segment = text[start..Math.Min(text.Length, end)].Trim();
            if (segment.Length == 0)
                return new List<string>();

            segments.Add(segment);
        }

        return segments;
    }

    private static int FindNarrationBoundaryNear(string text, int targetIndex)
    {
        var safeTarget = Math.Clamp(targetIndex, 0, text.Length);
        if (safeTarget <= 0 || safeTarget >= text.Length)
            return safeTarget;

        var window = Math.Max(24, Math.Min(180, text.Length / 8));
        var start = Math.Max(1, safeTarget - window);
        var end = Math.Min(text.Length - 1, safeTarget + window);
        var span = text[start..end];
        var delimiters = new[] { "\n\n", ". ", "? ", "! ", "; ", ": ", "\n", ", ", " " };
        foreach (var delimiter in delimiters)
        {
            var pivot = Math.Max(0, Math.Min(span.Length - 1, safeTarget - start - 1));
            var beforeIdx = span.LastIndexOf(delimiter, pivot, StringComparison.Ordinal);
            if (beforeIdx >= 0)
                return start + beforeIdx + delimiter.Length;
        }

        return safeTarget;
    }

    private static List<string> BuildBoardLinesFromNarrationSegments(
        IReadOnlyList<string> originalLines,
        IReadOnlyList<string> narrationSegments)
    {
        if (narrationSegments.Count == 0)
            return new List<string>();

        var repairedLines = narrationSegments
            .Select(SummarizeNarrationSegmentToBoardLine)
            .ToList();

        var merged = new List<string>(narrationSegments.Count);
        for (var i = 0; i < repairedLines.Count; i++)
        {
            var current = i < originalLines.Count ? (originalLines[i] ?? "").Trim() : "";
            merged.Add(IsDrawLine(current) ? current : repairedLines[i]);
        }

        return PolishGeneratedBoardLines(CleanBoardLines(merged), narrationSegments);
    }

    private static string SummarizeNarrationSegmentToBoardLine(string? rawSegment, int index)
    {
        var text = Regex.Replace((rawSegment ?? "").Trim(), @"\s+", " ");
        if (text.Length == 0)
            return $"Step {index + 1}";

        if (Regex.IsMatch(text, @"right triangles are one of the fastest ways", RegexOptions.IgnoreCase))
            return "Right triangles -> clean algebra";
        if (Regex.IsMatch(text, @"right triangles.*pythagorean theorem", RegexOptions.IgnoreCase))
            return "Right triangles + Pythagorean theorem";
        if (Regex.IsMatch(text, @"pythagorean theorem connects the three side lengths", RegexOptions.IgnoreCase))
            return "Pythagorean theorem: a^2 + b^2 = c^2";
        if (Regex.IsMatch(text, @"draw a right triangle|right triangle.*label the legs", RegexOptions.IgnoreCase))
            return "DRAW: triangle right; legs a,b; hypotenuse c";
        if (Regex.IsMatch(text, @"point to the hypotenuse|focus .*hypotenuse|keep .*diagram", RegexOptions.IgnoreCase))
            return "DRAW: focus hyp";
        if (Regex.IsMatch(text, @"coordinate graph|draw the axes|on the graph", RegexOptions.IgnoreCase))
            return "DRAW: axes x=-5..5 y=-5..5";
        if (Regex.IsMatch(text, @"bar chart|bar graph", RegexOptions.IgnoreCase))
            return "DRAW: bar A=2 B=5 C=3";
        if (Regex.IsMatch(text, @"focus .*bar", RegexOptions.IgnoreCase))
            return "DRAW: focus bar B";
        if (Regex.IsMatch(text, @"circle.*radius", RegexOptions.IgnoreCase))
            return "DRAW: circle id=c1 center=(0,0) r=3";

        var exampleMatch = Regex.Match(text, @"example\s+\d+", RegexOptions.IgnoreCase);
        if (exampleMatch.Success && exampleMatch.Index > 0)
            text = text[exampleMatch.Index..];

        text = Regex.Replace(text, @"^today we(?:'re|’re| are) focusing on\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^before we move on,?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^let['’]?s [^:]{0,30}:\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^let['’]?s break this down[:,]?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^now,?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^(?:alright|okay|so|right)[,:\s]+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^notice\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^remember\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^the big idea is(?: simple)?[: ]+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^this means(?: that)?\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^that means(?: that)?\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^we need to\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^we can\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^we\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^you can\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^you\s+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^step\s+\d+\s*(?:is|:)?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^to compute\s*:\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^a quick reasonableness check\s*:\s*", "Check: ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^take the square root\s*:\s*", "sqrt -> ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^the answer is\s+", "Answer: ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^divide both sides by\s+", "Divide by ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^multiply both sides by\s+", "Multiply by ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^add\s+(.+?)\s+to both sides$", "Add $1", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^subtract\s+(.+?)\s+from both sides$", "Subtract $1", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^plug in\s+", "Plug in: ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^substitute\s+", "Substitute: ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^combine like terms\b", "Combine like terms", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^solve for\s+", "Solve for ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bexample\s+(\d+)\b", "Ex$1", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b([A-Za-z0-9]+)\s+squared\b", "$1^2", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bplus\b", "+", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bminus\b", "-", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bequals\b", "=", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bgreater than\b", ">", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bless than\b", "<", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bright angle\b", "90 deg", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\s*([=+\-<>:,;])\s*", " $1 ");
        text = Regex.Replace(text, @"\bsqrt\s*-\s*>\s*", "sqrt -> ", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\s+", " ").Trim();

        var line = Regex.Split(text, @"[.!?]")
            .Select(part => part.Trim())
            .FirstOrDefault(part => part.Length > 0) ?? text;

        line = Regex.Replace(line, @"\bEx(\d+)\s*:", "Ex$1:");
        line = Regex.Replace(line, @"\bCheck\s*:", "Check:");
        return string.IsNullOrWhiteSpace(line) ? $"Step {index + 1}" : line;
    }

    private static List<string> PolishGeneratedBoardLines(
        IReadOnlyList<string> boardLines,
        IReadOnlyList<string>? narrationSegments = null)
    {
        if (boardLines.Count == 0)
            return new List<string>();

        var polished = new List<string>(boardLines.Count);
        var canUseNarrationHints = narrationSegments is not null && narrationSegments.Count == boardLines.Count;

        for (var i = 0; i < boardLines.Count; i++)
        {
            var raw = (boardLines[i] ?? "").Trim();
            if (raw.Length == 0)
                continue;

            if (IsDrawLine(raw))
            {
                polished.Add(CanonicalizeDrawLine(raw));
                continue;
            }

            var candidate = FinalizeBoardLineStyle(raw);
            if (LooksLikeVerboseBoardSentence(candidate))
            {
                var summarizedLine = FinalizeBoardLineStyle(SummarizeNarrationSegmentToBoardLine(candidate, i));
                var narrationHint = canUseNarrationHints
                    ? FinalizeBoardLineStyle(SummarizeNarrationSegmentToBoardLine(narrationSegments![i], i))
                    : "";
                candidate = ChooseBoardStyleCandidate(candidate, summarizedLine, narrationHint);
            }

            polished.Add(string.IsNullOrWhiteSpace(candidate) ? $"Step {i + 1}" : candidate);
        }

        return CleanBoardLines(polished);
    }

    private static string ChooseBoardStyleCandidate(params string[] candidates)
    {
        var best = "";
        var bestScore = double.NegativeInfinity;

        foreach (var raw in candidates)
        {
            var candidate = FinalizeBoardLineStyle(raw);
            if (candidate.Length == 0)
                continue;

            var score = ScoreBoardStyleCandidate(candidate);
            if (score > bestScore)
            {
                best = candidate;
                bestScore = score;
            }
        }

        return best;
    }

    private static double ScoreBoardStyleCandidate(string line)
    {
        var score = 0.0;
        var wordCount = CountWords(line);
        var hasEquation = Regex.IsMatch(line, @"[=<>+\-/*^]|\b\d+\b");
        var hasBoardLabel = Regex.IsMatch(line, @"^(?:Q|Ex\d+|Example \d+|Rule|Goal|Method|Takeaway|Trap|Answer|Solution|Check|Quick check|Key idea|Definition|Formula|Setup|Substitute|Rewrite|Combine|Solve|Graph|Plot|Compare)\s*:", RegexOptions.IgnoreCase);

        if (hasEquation)
            score += 2.5;
        if (hasBoardLabel)
            score += 2.0;
        if (line.Length is >= 6 and <= 56)
            score += 1.5;
        if (wordCount is >= 1 and <= 7)
            score += 1.0;
        if (LooksLikeVerboseBoardSentence(line))
            score -= 4.0;

        score -= Math.Max(0, line.Length - 64) * 0.04;
        score -= Math.Max(0, wordCount - 9) * 0.5;
        return score;
    }

    private static bool LooksLikeVerboseBoardSentence(string? raw)
    {
        var line = (raw ?? "").Trim();
        if (line.Length == 0 || IsDrawLine(line))
            return false;

        var wordCount = CountWords(line);
        var hasEquation = Regex.IsMatch(line, @"[=<>+\-/*^]|\b\d+\b");
        var hasBoardLabel = Regex.IsMatch(line, @"^(?:Q|Ex\d+|Example \d+|Rule|Goal|Method|Takeaway|Trap|Answer|Solution|Check|Quick check|Key idea|Definition|Formula|Setup|Substitute|Rewrite|Combine|Solve|Graph|Plot|Compare)\s*:", RegexOptions.IgnoreCase);
        var startsLikeSpeech = Regex.IsMatch(line, @"^(?:today|alright|okay|so|now|first|next|then|finally|remember|notice|we|you|this|that|these|those|let['’]?s|let us)\b", RegexOptions.IgnoreCase);
        var endsLikeSentence = Regex.IsMatch(line, @"[.!?]$");

        if (line.Length > 72)
            return true;
        if (hasBoardLabel && line.Length <= 64)
            return false;
        if (startsLikeSpeech && wordCount >= 4)
            return true;
        if (endsLikeSentence && wordCount >= 5)
            return true;
        if (!hasEquation && wordCount >= 9)
            return true;

        return false;
    }

    private static string FinalizeBoardLineStyle(string? raw)
    {
        var text = (raw ?? "").Trim();
        if (text.Length == 0 || IsDrawLine(text))
            return text;

        text = Regex.Replace(text, @"^(?:alright|okay|so|now|right)[,:\s]+", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"^(?:we|you)\s+(?=(?:can|need|divide|multiply|add|subtract|set|plug|substitute|factor|graph|check|solve|isolate|combine|rewrite|use)\b)", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b(?:this|that)\s+means(?: that)?\b\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\bwe get\b\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b(?:and\s+)?that gives us\b\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\b(?:so|then|next|finally|first)\b[:,]?\s*", "", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\s+", " ").Trim();
        text = text.TrimEnd('.', '!', '?');
        return text;
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

    private static AiVideoPack EnsureMathLessonHasVisuals(AiVideoPack pack, string topic, LessonLength length, bool allowGenericFallback = true)
    {
        if (!IsLikelyMathTopic(topic))
            return pack;

        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var visualLines = BuildRequiredMathVisualLines(topic, allowGenericFallback);
        if (visualLines.Count == 0)
            return pack;

        var needsBoardPatch = NeedsMathVisualBoardPatch(boardLines, length);
        var hasConflictingVisuals = HasConflictingMathVisuals(boardLines, topic);
        var narration = HumanizeNarration(pack.Narration);
        var needsNarrationCue = CountVisualNarrationMentions(narration) < 2;

        if (!needsBoardPatch && !needsNarrationCue && !hasConflictingVisuals)
            return pack;

        if (needsBoardPatch || hasConflictingVisuals)
        {
            if (boardLines.Count == 0)
                boardLines.Add(CleanBoardLines(new[] { $"TOPIC: {topic}" }).FirstOrDefault() ?? "TOPIC");

            var requiredVisualSet = new HashSet<string>(visualLines, StringComparer.OrdinalIgnoreCase);
            boardLines = boardLines
                .Where(line => !requiredVisualSet.Contains(line))
                .ToList();

            if (hasConflictingVisuals)
            {
                boardLines = boardLines
                    .Where(line => !IsConflictingMathVisualLine(line, topic))
                    .ToList();
            }

            var insertAt = boardLines.Count <= 2
                ? boardLines.Count
                : Math.Min(5, boardLines.Count);

            boardLines.InsertRange(insertAt, visualLines);
            boardLines = CleanBoardLines(boardLines);
        }

        if (needsNarrationCue)
            narration = EnsureMathNarrationMentionsVisuals(narration, topic);

        if (boardLines.Count == 0)
            boardLines.Add(CleanBoardLines(new[] { $"TOPIC: {topic}" }).FirstOrDefault() ?? "TOPIC");

        boardLines = NormalizeMathVisualSceneTransitions(boardLines);

        return pack with
        {
            Narration = narration,
            BoardLines = boardLines,
            BoardTimings = EvenTimings(boardLines.Count),
            BoardTimestampSeconds = new List<double>(),
            NarrationSegments = new List<string>()
        };
    }

    private static AiVideoPack EnsureStudentQuestionHasVisuals(
        AiVideoPack pack,
        IReadOnlyList<string> studentDrawCommands,
        string headerLine)
    {
        if (studentDrawCommands.Count == 0)
            return pack;

        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var existingDrawKeys = boardLines
            .Where(IsDrawLine)
            .Select(NormalizeDrawCommandKey)
            .Where(key => key.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var missingVisualLines = studentDrawCommands
            .Select(command => (command ?? "").Trim())
            .Where(command => command.Length > 0)
            .Select(command => $"DRAW: {command}")
            .Where(line => !existingDrawKeys.Contains(NormalizeDrawCommandKey(line)))
            .ToList();

        if (missingVisualLines.Count == 0)
            return pack;

        if (boardLines.Count == 0)
            boardLines.Add(string.IsNullOrWhiteSpace(headerLine) ? "Q:" : headerLine);

        var hasHeader = !string.IsNullOrWhiteSpace(headerLine)
            && boardLines.Count > 0
            && string.Equals(boardLines[0], headerLine, StringComparison.OrdinalIgnoreCase);

        var insertAt = hasHeader
            ? Math.Min(boardLines.Count, boardLines.Count > 1 ? 2 : 1)
            : Math.Min(boardLines.Count, 1);

        boardLines.InsertRange(insertAt, missingVisualLines);
        boardLines = CleanBoardLines(boardLines);

        return pack with
        {
            BoardLines = boardLines,
            BoardTimings = EvenTimings(boardLines.Count),
            BoardTimestampSeconds = new List<double>(),
            NarrationSegments = new List<string>()
        };
    }

    private static bool NeedsMathVisualRewrite(AiVideoPack pack, LessonLength length)
    {
        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        return NeedsMathVisualBoardPatch(boardLines, length)
            || CountVisualNarrationMentions(pack.Narration) < 2;
    }

    private static bool NeedsMathVisualBoardPatch(IReadOnlyList<string> boardLines, LessonLength length)
    {
        var drawCount = boardLines.Count(IsDrawLine);
        var focusCount = boardLines.Count(line => line.StartsWith("DRAW: focus", StringComparison.OrdinalIgnoreCase));
        var minDrawCount = length == LessonLength.Short ? 2 : 4;
        var minFocusCount = length == LessonLength.Short ? 1 : 2;
        var firstDrawIndex = -1;
        for (var i = 0; i < boardLines.Count; i++)
        {
            if (!IsDrawLine(boardLines[i]))
                continue;

            firstDrawIndex = i;
            break;
        }

        var earlyDrawThreshold = Math.Max(3, boardLines.Count / 4);
        var hasEarlyDraw = firstDrawIndex >= 0 && firstDrawIndex <= earlyDrawThreshold;

        return drawCount < minDrawCount
            || focusCount < minFocusCount
            || !hasEarlyDraw;
    }

    private static List<string> NormalizeMathVisualSceneTransitions(IReadOnlyList<string> boardLines)
    {
        if (boardLines.Count == 0)
            return new List<string>();

        var normalized = new List<string>(boardLines.Count + 4);
        string? currentScene = null;

        foreach (var line in boardLines)
        {
            var raw = (line ?? "").Trim();
            if (raw.Length == 0)
                continue;

            if (!IsDrawLine(raw))
            {
                normalized.Add(raw);
                continue;
            }

            var canonical = CanonicalizeDrawLine(raw);
            var scene = GetVisualSceneKind(canonical);

            if (scene == "clear")
            {
                if (normalized.Count == 0 || !string.Equals(normalized[^1], "DRAW: clear", StringComparison.OrdinalIgnoreCase))
                    normalized.Add("DRAW: clear");
                currentScene = null;
                continue;
            }

            if (scene is not null && currentScene is not null && !string.Equals(scene, currentScene, StringComparison.OrdinalIgnoreCase))
            {
                if (normalized.Count == 0 || !string.Equals(normalized[^1], "DRAW: clear", StringComparison.OrdinalIgnoreCase))
                    normalized.Add("DRAW: clear");
                currentScene = null;
            }

            normalized.Add(canonical);

            if (scene is not null)
                currentScene = scene;
        }

        return CleanBoardLines(normalized);
    }

    private static string? GetVisualSceneKind(string? line)
    {
        if (!IsDrawLine(line))
            return null;

        var normalized = NormalizeDrawCommandKey(line);
        if (normalized.Length == 0)
            return null;

        if (normalized.StartsWith("clear", StringComparison.OrdinalIgnoreCase))
            return "clear";
        if (normalized.StartsWith("focus", StringComparison.OrdinalIgnoreCase))
            return null;
        if (normalized.StartsWith("move", StringComparison.OrdinalIgnoreCase))
            return null;
        if (normalized.StartsWith("triangle", StringComparison.OrdinalIgnoreCase))
            return "triangle";
        if (normalized.StartsWith("bar", StringComparison.OrdinalIgnoreCase))
            return "bar";
        if (normalized.StartsWith("axes", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("line", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("point", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("circle", StringComparison.OrdinalIgnoreCase)
            || normalized.StartsWith("square", StringComparison.OrdinalIgnoreCase))
            return "cartesian";

        return null;
    }

    private static int CountVisualNarrationMentions(string? narration)
    {
        if (string.IsNullOrWhiteSpace(narration))
            return 0;

        return Regex.Matches(
            narration,
            @"\b(?:graph|diagram|draw|drawn|triangle|circle|axes|axis|point|points|bar|bars|plot|plotted|visual|coordinate|intersection|hypotenuse|radius|angle|sketch|sketched)\b",
            RegexOptions.IgnoreCase).Count;
    }

    private static string EnsureMathNarrationMentionsVisuals(string narration, string topic)
    {
        var spoken = HumanizeNarration(narration);
        if (!IsLikelyMathTopic(topic) || CountVisualNarrationMentions(spoken) >= 2)
            return spoken;

        return HumanizeNarration($"{spoken}\n\n{BuildMathVisualNarrationCue(topic)}");
    }

    private static string BuildMathVisualNarrationCue(string topic)
    {
        var normalized = (topic ?? "").Trim().ToLowerInvariant();

        if (NeedsNonRightTriangleCounterexample(normalized))
        {
            return "Sketch a non-right triangle and point out that none of its angles is 90 degrees. That picture shows why the Pythagorean theorem does not apply in this case.";
        }

        if (ContainsAny(normalized, "derivative", "derivatives", "differentiate", "differentiation", "calculus", "limit", "limits", "integral", "integrals", "tangent line", "secant"))
        {
            return "Put a graph on the board, mark a key point, and talk about the slope there before you manipulate symbols. That picture makes rate of change feel concrete instead of abstract.";
        }

        if (ContainsAny(normalized, "sine", "cosine", "tangent", "trigonometry")
            || ContainsToken(normalized, "sin", "cos", "tan", "trig", "sohcahtoa", "soh-cah-toa"))
        {
            return "Keep a right-triangle sketch in view and point to theta, the opposite side, and the hypotenuse before you calculate. That diagram shows which ratio belongs to the question.";
        }

        if (ContainsAny(normalized, "triangle", "triangles", "pythagorean", "geometry", "angle", "angles", "area", "perimeter", "volume", "surface area"))
        {
            return "Start by sketching the shape and labeling the important sides or angles. Use that drawing to see the structure first, then compute from the labels.";
        }

        if (ContainsAny(normalized, "circle", "circles", "radius", "diameter", "arc", "sector"))
        {
            return "Sketch the circle, mark the center, and point to the radius or arc you care about. That picture makes it clear which distance or portion the formula is measuring.";
        }

        if (ContainsAny(normalized, "percent", "percentage", "percentages", "unit rate", "ratio", "proportion", "probability", "statistics", "mean", "median", "mode", "data", "distribution"))
        {
            return "Draw a quick bar model or data picture before doing the arithmetic. Seeing the quantities side by side makes the comparison and percent relationship much easier to explain.";
        }

        if (ContainsAny(normalized, "system", "systems", "linear", "slope", "intercept", "graph", "graphs", "plot", "plots", "table", "tables", "function", "functions", "equation", "equations", "inequality", "inequalities", "coordinate", "coordinates", "algebra", "quadratic", "quadratics", "parabola", "parabolas"))
        {
            return "Plot the key points and lines on axes before pushing through the algebra. The graph gives a visual reason for each step instead of turning the lesson into symbol manipulation only.";
        }

        return "Begin with a quick sketch or plotted visual so the math has a picture before the calculations start. Use that drawing to explain what each number represents as you solve.";
    }

    private static string BuildVideoQuestionVisualContext(
        VideoJob video,
        string question,
        IReadOnlyList<string> recentLines,
        string script,
        IReadOnlyList<string> studentBoardTextLines,
        IReadOnlyList<string> studentDrawCommands)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(video.Title))
            parts.Add(video.Title);

        if (!string.IsNullOrWhiteSpace(video.SourceType))
            parts.Add(video.SourceType);

        if (!string.IsNullOrWhiteSpace(question))
            parts.Add(question);

        if (recentLines.Count > 0)
            parts.Add(string.Join('\n', recentLines));

        if (studentBoardTextLines.Count > 0)
            parts.Add(string.Join('\n', studentBoardTextLines));

        if (studentDrawCommands.Count > 0)
            parts.Add(string.Join('\n', studentDrawCommands));

        if (!string.IsNullOrWhiteSpace(script))
            parts.Add(script);

        return string.Join("\n", parts);
    }

    private static List<string> CleanStudentDrawCommands(IEnumerable<string>? commands)
    {
        if (commands is null)
            return new List<string>();

        var prefixed = commands
            .Select(command => (command ?? "").Trim())
            .Where(command => command.Length > 0)
            .Select(command => command.StartsWith("DRAW", StringComparison.OrdinalIgnoreCase) ? command : $"DRAW: {command}");

        return CleanBoardLines(prefixed)
            .Where(IsDrawLine)
            .Select(command => command
                .Replace("DRAW:", "", StringComparison.OrdinalIgnoreCase)
                .Replace("DRAW ", "", StringComparison.OrdinalIgnoreCase)
                .Replace("DRAW-", "", StringComparison.OrdinalIgnoreCase)
                .Trim())
            .Where(command => command.Length > 0)
            .ToList();
    }

    private static string BuildStudentQuestionBoardPromptBlock(
        IReadOnlyList<string> studentBoardTextLines,
        IReadOnlyList<string> studentDrawCommands)
    {
        if (studentBoardTextLines.Count == 0 && studentDrawCommands.Count == 0)
            return "";

        var builder = new StringBuilder();
        builder.Append("\n\nStudent-authored board before asking:");

        if (studentBoardTextLines.Count > 0)
        {
            builder.Append("\nWritten on board:\n- ");
            builder.Append(string.Join("\n- ", studentBoardTextLines));
        }

        if (studentDrawCommands.Count > 0)
        {
            builder.Append("\nVisuals on board:\n- ");
            builder.Append(string.Join("\n- ", studentDrawCommands.Select(command => $"DRAW: {command}")));
        }

        builder.Append("\nUse that board context directly in the answer whenever it is relevant.");
        return builder.ToString();
    }

    private async Task<AiVideoPack> RepairGeneratedBoardAlignmentAsync(AiVideoPack pack, CancellationToken ct)
    {
        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        var narrationSegments = CleanNarrationSegments(pack.NarrationSegments ?? new List<string>());
        if (boardLines.Count == 0 || narrationSegments.Count != boardLines.Count || narrationSegments.Count < 8)
            return pack;

        var hasVerboseBoardLines = boardLines.Any(LooksLikeVerboseBoardSentence);
        if (!HasWeakBoardNarrationAlignment(boardLines, narrationSegments) && !hasVerboseBoardLines)
            return pack;

        const string systemPrompt =
            "You repair whiteboard lesson beats so each whiteboard line matches its paired spoken line. " +
            "Return plain text only: exactly one short whiteboard line per spoken line, in the same order, no extra commentary.";

        var spokenLines = narrationSegments
            .Select((line, index) => $"{index + 1}. {line}")
            .ToList();
        var currentBoard = boardLines
            .Select((line, index) => $"{index + 1}. {line}")
            .ToList();

        var userPrompt =
            $"Rewrite the WHITEBOARD list so it aligns 1-to-1 with the SPOKEN_LINES list.\n\n" +
            $"Requirements:\n" +
            $"- Return exactly {narrationSegments.Count} whiteboard lines.\n" +
            "- Keep each line terse and board-like, usually 3-10 words or one equation. Avoid full-sentence narration on the board.\n" +
            "- Keep non-DRAW lines under about 72 characters whenever possible.\n" +
            "- Complete the thought, but do not end with ellipses or clipped fragments.\n" +
            "- Use ASCII math shorthand when useful.\n" +
            "- Prefer notes like \"m = 2, b = 1\", \"Substitute: x=4\", or \"Check: 3(4)=12\" instead of spoken-style sentences.\n" +
            "- Bad: \"We divide both sides by 3 to isolate x.\" Good: \"Divide by 3\" or \"x = 4\".\n" +
            "- Preserve the lesson order exactly.\n" +
            "- If a spoken line is a hook, vocabulary setup, warning, or transition, give it a matching short board line.\n" +
            "- Keep DRAW lines only when the spoken line is clearly about the diagram or focus point.\n" +
            "- Output only the repaired whiteboard lines, one per line, prefixed with '- '.\n\n" +
            "Current WHITEBOARD:\n" +
            string.Join('\n', currentBoard) +
            "\n\nSPOKEN_LINES:\n" +
            string.Join('\n', spokenLines);

        var repairedText = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
        var repairedBoard = PolishGeneratedBoardLines(CleanBoardLines(ParseBoardLines(repairedText)), narrationSegments);
        if (repairedBoard.Count != boardLines.Count)
            return pack;

        return pack with { BoardLines = repairedBoard };
    }

    private async Task<AiVideoPack> EnsureLessonBeatSyncAsync(
        string topic,
        LessonLength length,
        AiVideoPack pack,
        CancellationToken ct)
    {
        var boardLines = CleanBoardLines(pack.BoardLines ?? new List<string>());
        if (boardLines.Count == 0 || !IsOpenAiEnabled())
            return pack;

        var narration = HumanizeNarration(pack.Narration);
        var narrationSegments = CleanNarrationSegments(pack.NarrationSegments ?? new List<string>());
        var timings = CleanTimings(new List<double>(pack.BoardTimings ?? new List<double>()), boardLines.Count, narration);
        var timestampSeconds = CleanTimestampSeconds(new List<double>(pack.BoardTimestampSeconds ?? new List<double>()), boardLines.Count, narration);
        var hasDrawLines = boardLines.Any(IsDrawLine);
        var hasWeakAlignment = narrationSegments.Count == boardLines.Count && HasWeakBoardNarrationAlignment(boardLines, narrationSegments);
        var hasVisualNarrationGap = hasDrawLines && CountVisualNarrationMentions(narration) < Math.Max(2, boardLines.Count(line => line.StartsWith("DRAW: focus", StringComparison.OrdinalIgnoreCase)));
        var needsRepair = narrationSegments.Count != boardLines.Count || hasWeakAlignment || hasVisualNarrationGap;

        if (!needsRepair)
            return new AiVideoPack(narration, boardLines, timings, timestampSeconds, narrationSegments);

        const string systemPrompt =
            "You rewrite SAT lesson narration so it matches a fixed whiteboard plan beat-by-beat. " +
            "Return plain text only and keep the teacher voice natural, human, and classroom-like.";

        var lessonShape = length == LessonLength.Short ? "short custom lesson" : "long custom lesson";
        var targetWords = length == LessonLength.Short ? "420-700 words" : "1700-2500 words";
        var boardText = string.Join('\n', boardLines.Select(line => $"- {line}"));
        var drawRequirement = hasDrawLines
            ? "- For every DRAW line, the paired spoken line must naturally explain the visual at that exact beat. Do not say \"now I'm drawing\" or \"on the board I'm writing\".\n"
            : "";

        for (var attempt = 0; attempt < 2; attempt++)
        {
            var retryRequirement = attempt == 0
                ? ""
                : "- Prior draft still drifted from the board. Tighten the beat matching so each spoken line directly explains its paired board line.\n";

            var userPrompt =
                $"Rewrite this {lessonShape} on the topic \"{topic}\" so the narration is perfectly synchronized to the fixed board plan.\n\n" +
                "Output format EXACTLY:\n" +
                "NARRATION:\n" +
                "(full spoken lesson made from the spoken lines below)\n\n" +
                "SPOKEN_LINES:\n" +
                "- (spoken beat aligned to whiteboard line 1)\n" +
                "- (spoken beat aligned to whiteboard line 2)\n" +
                "...\n\n" +
                "WHITEBOARD:\n" +
                "- (copy the fixed board line 1 exactly)\n" +
                "- (copy the fixed board line 2 exactly)\n" +
                "...\n\n" +
                "TIMINGS:\n" +
                "- 00:04\n" +
                "- 00:11\n" +
                "...\n\n" +
                "Requirements:\n" +
                $"- Keep the overall lesson content and order, but rebuild the speech so it matches the board 1-to-1.\n" +
                $"- Narration target length: {targetWords}.\n" +
                "- WHITEBOARD is locked. Copy every line back exactly, in the same order and same count.\n" +
                "- SPOKEN_LINES must contain exactly one spoken beat per whiteboard line, in the same order and same count.\n" +
                "- Each spoken line should sound like a real teacher speaking while explaining that exact board beat.\n" +
                "- Expand symbols and shorthand into natural speech.\n" +
                "- Smooth the beats together so NARRATION reads like one continuous human explanation, not a bullet list.\n" +
                "- Use short transition phrases between beats so the voice feels natural and connected.\n" +
                BuildConfiguredNarrationPromptRules() +
                "- Do not use meta-action narration like \"now I'm writing\", \"let's draw\", or \"on the board\".\n" +
                drawRequirement +
                "- Timings: one strictly increasing timestamp per whiteboard line, format MM:SS or HH:MM:SS.\n" +
                "- Each timestamp is when that board line should START from narration start.\n" +
                retryRequirement +
                "\nFixed WHITEBOARD:\n" +
                boardText +
                "\n\nCurrent narration draft:\n" +
                narration;

            var rebuiltText = await _ai.CompleteAsync(systemPrompt, userPrompt, ct);
            var rebuiltPack = ParseVideoPack(rebuiltText, fallbackBoardHeader: boardLines[0]);
            var rebuiltSegments = CleanNarrationSegments(rebuiltPack.NarrationSegments ?? new List<string>());
            if (rebuiltSegments.Count != boardLines.Count)
                continue;

            var rebuiltNarration = BuildNarrationFromSegments(rebuiltSegments, rebuiltPack.Narration);
            var rebuiltTimings = CleanTimings(new List<double>(rebuiltPack.BoardTimings ?? new List<double>()), boardLines.Count, rebuiltNarration);
            var rebuiltTimestampSeconds = CleanTimestampSeconds(new List<double>(rebuiltPack.BoardTimestampSeconds ?? new List<double>()), boardLines.Count, rebuiltNarration);
            var rebuiltHasVisualNarrationGap = hasDrawLines &&
                CountVisualNarrationMentions(rebuiltNarration) < Math.Max(2, boardLines.Count(line => line.StartsWith("DRAW: focus", StringComparison.OrdinalIgnoreCase)));

            if (HasWeakBoardNarrationAlignment(boardLines, rebuiltSegments) || rebuiltHasVisualNarrationGap)
                continue;

            return new AiVideoPack(rebuiltNarration, boardLines, rebuiltTimings, rebuiltTimestampSeconds, rebuiltSegments);
        }

        return new AiVideoPack(narration, boardLines, timings, timestampSeconds, narrationSegments.Count == boardLines.Count ? narrationSegments : new List<string>());
    }

    private static bool HasWeakBoardNarrationAlignment(IReadOnlyList<string> boardLines, IReadOnlyList<string> narrationSegments)
    {
        if (boardLines.Count == 0 || boardLines.Count != narrationSegments.Count)
            return false;

        var alignedCount = 0;
        var introWindowAlignedCount = 0;
        var introWindow = Math.Min(10, boardLines.Count);

        for (var i = 0; i < boardLines.Count; i++)
        {
            if (BoardLineMatchesNarration(boardLines[i], narrationSegments[i]))
            {
                alignedCount++;
                if (i < introWindow)
                    introWindowAlignedCount++;
            }
        }

        var alignedRatio = alignedCount / (double)boardLines.Count;
        var introRatio = introWindowAlignedCount / (double)introWindow;
        return alignedRatio < 0.72 || introRatio < 0.6;
    }

    private static bool BoardLineMatchesNarration(string boardLine, string narrationSegment)
    {
        var line = (boardLine ?? "").Trim();
        var narration = (narrationSegment ?? "").Trim();
        if (line.Length == 0 || narration.Length == 0)
            return false;

        var lineKeywords = ExtractAlignmentKeywords(line);
        if (lineKeywords.Count == 0)
            return false;

        var narrationKeywords = ExtractAlignmentKeywords(narration).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var overlapCount = lineKeywords.Count(keyword => narrationKeywords.Contains(keyword));
        var requiredOverlap = lineKeywords.Count >= 4 ? 2 : 1;

        if (IsDrawLine(line))
        {
            var focusMatchers = new List<string[]>();
            if (line.Contains("focus", StringComparison.OrdinalIgnoreCase))
            {
                if (line.Contains("theta", StringComparison.OrdinalIgnoreCase) || line.Contains("θ", StringComparison.Ordinal))
                    focusMatchers.Add(new[] { "theta", "θ", "angle" });
                if (line.Contains("right angle", StringComparison.OrdinalIgnoreCase))
                    focusMatchers.Add(new[] { "right angle", "90", "90-degree", "ninety-degree" });
                if (Regex.IsMatch(line, @"\bhyp(?:otenuse)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "hyp", "hypotenuse", "longest side" });
                if (Regex.IsMatch(line, @"\bopp(?:osite)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "opp", "opposite" });
                if (Regex.IsMatch(line, @"\badj(?:acent)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "adj", "adjacent" });
            }

            if (focusMatchers.Count > 0)
                return focusMatchers.Any(group => group.Any(token => narration.Contains(token, StringComparison.OrdinalIgnoreCase)));

            var talksAboutVisual = ContainsAny(narration,
                "triangle", "graph", "axes", "bar", "circle", "diagram", "picture", "plot", "sketch");
            return overlapCount >= 1 || talksAboutVisual;
        }

        return overlapCount >= requiredOverlap;
    }

    private static List<string> ExtractAlignmentKeywords(string text)
    {
        var matches = Regex.Matches((text ?? "").ToLowerInvariant(), @"[a-z0-9]+");
        var stop = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "the", "and", "then", "this", "that", "with", "from", "into", "your", "you", "our",
            "for", "are", "was", "were", "have", "has", "had", "let", "lets", "step", "line",
            "now", "onto", "over", "about", "what", "when", "where", "why", "how", "all", "any",
            "can", "just", "than", "them", "to", "of", "in", "on", "at", "by", "be", "as", "is",
            "it", "we", "us", "so"
        };

        var keywords = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in matches)
        {
            var token = match.Value.Trim();
            if (token.Length == 0)
                continue;

            var isNumber = token.Any(char.IsDigit);
            if (!isNumber && token.Length <= 1 && token is not ("x" or "y" or "a" or "b" or "c"))
                continue;
            if (stop.Contains(token))
                continue;
            if (seen.Add(token))
                keywords.Add(token);
            if (keywords.Count >= 8)
                break;
        }

        return keywords;
    }

    private static List<string> BuildRequiredMathVisualLines(string topic, bool allowGenericFallback = false)
    {
        var normalized = (topic ?? "").Trim().ToLowerInvariant();
        if (!IsLikelyMathTopic(normalized))
            return new List<string>();

        if (ContainsAny(normalized, "derivative", "derivatives", "differentiate", "differentiation", "calculus", "limit", "limits", "integral", "integrals", "tangent line", "secant"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-5..5",
                "DRAW: line y=2x+1",
                "DRAW: point (1,3) label=P",
                "DRAW: point (3,7) label=Q",
                "DRAW: focus (1,3)",
                "DRAW: focus line"
            });
        }

        if (ContainsAny(normalized, "sine", "cosine", "tangent", "trigonometry")
            || ContainsToken(normalized, "sin", "cos", "tan", "trig", "sohcahtoa", "soh-cah-toa"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: triangle right; legs opp,adj; hypotenuse hyp; angle θ",
                "DRAW: focus triangle theta",
                "DRAW: focus triangle opp",
                "DRAW: focus triangle hyp"
            });
        }

        if (NeedsNonRightTriangleCounterexample(normalized))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: triangle id=t1 angles 50 60 70; angle 60°",
                "DRAW: focus triangle angle",
                "DRAW: focus triangle a",
                "DRAW: focus triangle b"
            });
        }

        if (ContainsAny(normalized, "triangle", "triangles", "pythagorean"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: triangle right; legs a,b; hypotenuse c",
                "DRAW: focus triangle right angle",
                "DRAW: focus triangle hyp",
                "DRAW: focus triangle adj"
            });
        }

        if (ContainsAny(normalized, "circle", "circles", "radius", "diameter", "arc", "sector"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: circle id=c1 center=(0,0) r=3",
                "DRAW: point (0,0) label=center",
                "DRAW: point (3,0) label=r=3",
                "DRAW: focus (0,0)",
                "DRAW: focus (3,0)"
            });
        }

        if (ContainsAny(normalized, "rectangle", "rectangles", "square", "squares"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-5..5",
                "DRAW: square id=s1 center=(0,0) size=4 angle=0",
                "DRAW: focus square corner",
                "DRAW: focus square side",
                "DRAW: focus square center"
            });
        }

        if (ContainsAny(normalized, "percent", "percentage", "percentages", "unit rate", "ratio", "proportion", "probability", "statistics", "mean", "median", "mode", "data", "distribution"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: bar A=2 B=5 C=3",
                "DRAW: focus bar A",
                "DRAW: focus bar B",
                "DRAW: focus bar C"
            });
        }

        if (ContainsAny(normalized, "system", "systems"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-5..5",
                "DRAW: line y=2x+1",
                "DRAW: line y=-x+7",
                "DRAW: point (0,1) label=(0,1)",
                "DRAW: point (2,5) label=(2,5)",
                "DRAW: focus (0,1)",
                "DRAW: focus (2,5)"
            });
        }

        if (ContainsAny(normalized, "quadratic", "quadratics", "parabola", "parabolas", "polynomial", "polynomials", "factor", "factoring"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-1..9",
                "DRAW: point (-2,4) label=(-2,4)",
                "DRAW: point (0,0) label=(0,0)",
                "DRAW: point (2,4) label=(2,4)",
                "DRAW: focus (0,0)",
                "DRAW: focus (2,4)"
            });
        }

        if (ContainsAny(normalized, "linear", "slope", "intercept", "graph", "graphs", "plot", "plots", "table", "tables", "coordinate", "coordinates", "line", "lines"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-5..5",
                "DRAW: line y=2x+1",
                "DRAW: point (0,1) label=(0,1)",
                "DRAW: point (3,7) label=(3,7)",
                "DRAW: focus (0,1)",
                "DRAW: focus (3,7)"
            });
        }

        if (allowGenericFallback)
            return BuildGenericLessonMathVisualLines(normalized);

        return new List<string>();
    }

    private static List<string> BuildGenericLessonMathVisualLines(string normalizedTopic)
    {
        if (ContainsAny(normalizedTopic, "geometry", "area", "perimeter", "volume", "surface area", "polygon", "polygons", "trapezoid", "trapezoids", "congruent", "congruence", "angle", "angles"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: axes x=-5..5 y=-5..5",
                "DRAW: square id=s1 center=(0,0) size=4 angle=0",
                "DRAW: focus square corner",
                "DRAW: focus square side",
                "DRAW: focus square center"
            });
        }

        if (ContainsAny(normalizedTopic, "fraction", "fractions", "decimal", "decimals", "integer", "integers", "sequence", "sequences", "series", "rate", "rates", "mixture", "mixtures", "interest", "compound interest", "growth", "decay"))
        {
            return CleanBoardLines(new[]
            {
                "DRAW: bar A=2 B=5 C=3",
                "DRAW: focus bar A",
                "DRAW: focus bar B",
                "DRAW: focus bar C"
            });
        }

        return CleanBoardLines(new[]
        {
            "DRAW: axes x=-5..5 y=-5..5",
            "DRAW: line y=2x+1",
            "DRAW: point (0,1) label=(0,1)",
            "DRAW: point (3,7) label=(3,7)",
            "DRAW: focus (0,1)",
            "DRAW: focus (3,7)"
        });
    }

    private static bool NeedsNonRightTriangleCounterexample(string text)
    {
        var normalized = (text ?? "").Trim().ToLowerInvariant();
        if (!ContainsAny(normalized, "triangle", "triangles", "pythagorean"))
            return false;

        return Regex.IsMatch(
            normalized,
            @"\b(?:not\s+usable|not\s+use(?:d)?|cannot\s+use|can't\s+use|does\s+not\s+apply|doesn't\s+apply|cannot\s+apply|can't\s+apply|does\s+not\s+work|doesn't\s+work|not\s+work|fails?|invalid|not\s+valid|wrong|counterexample|exception|when\s+not|when\s+is\s+it\s+not|when\s+is\s+the\s+pythagorean|without\s+a\s+90(?:-|\s)?degree|no\s+90(?:-|\s)?degree|non[-\s]?right)\b",
            RegexOptions.IgnoreCase);
    }

    private static bool HasConflictingMathVisuals(IReadOnlyList<string> boardLines, string topic) =>
        boardLines.Any(line => IsConflictingMathVisualLine(line, topic));

    private static bool IsConflictingMathVisualLine(string? line, string topic)
    {
        if (!IsDrawLine(line))
            return false;

        if (NeedsNonRightTriangleCounterexample(topic))
        {
            var normalized = NormalizeDrawCommandKey(line);
            if (normalized.StartsWith("triangle right", StringComparison.OrdinalIgnoreCase))
                return true;
            if (normalized.Contains("focus triangle right angle", StringComparison.OrdinalIgnoreCase))
                return true;
            if (normalized.Contains("focus triangle hyp", StringComparison.OrdinalIgnoreCase))
                return true;
            if (normalized.Contains("hypotenuse", StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static bool IsLikelyMathTopic(string text)
    {
        return ContainsAny(text,
            "math", "algebra", "equation", "equations", "inequality", "inequalities",
            "expression", "expressions", "formula", "formulas", "literal equation", "literal equations",
            "function", "functions", "system", "systems", "slope", "intercept",
            "linear", "quadratic", "quadratics", "parabola", "parabolas",
            "polynomial", "polynomials", "factor", "factoring", "radical", "radicals", "rational", "rationals",
            "calculus", "derivative", "derivatives", "differentiate", "differentiation", "limit", "limits", "integral", "integrals", "tangent line", "secant",
            "exponent", "exponents", "absolute value", "coordinate", "coordinates",
            "graph", "graphs", "plot", "plots", "table", "tables",
            "percent", "percentage", "percentages", "ratio", "proportion", "unit rate", "probability", "statistics",
            "mean", "median", "mode", "data", "distribution",
            "geometry", "triangle", "triangles", "circle", "circles", "angle", "angles",
            "area", "perimeter", "volume", "surface area", "pythagorean",
            "fraction", "fractions", "decimal", "decimals", "integer", "integers",
            "trigonometry", "sine", "cosine", "tangent", "degree", "degrees", "radian", "radians",
            "similarity", "similar triangles", "congruent", "congruence",
            "midpoint", "distance formula", "sequence", "sequences", "series",
            "rate", "rates", "mixture", "mixtures", "work problem", "work problems", "word problem", "word problems",
            "exponential", "logarithm", "logarithms", "domain", "range", "vertex", "vertices", "root", "roots", "zero", "zeros",
            "interest", "compound interest", "growth", "decay", "imaginary", "complex number", "complex numbers", "matrix", "matrices", "vector", "vectors", "asymptote", "asymptotes",
            "polygon", "polygons", "rectangle", "rectangles", "square", "squares", "trapezoid", "trapezoids")
            || ContainsToken(text, "sin", "cos", "tan", "trig", "sohcahtoa", "soh-cah-toa")
            || Regex.IsMatch(text ?? "", @"\b(?:solve|simplify|evaluate|substitute|isolate|factor|expand)\b", RegexOptions.IgnoreCase)
            || Regex.IsMatch(text ?? "", @"[0-9xyabcmn]\s*[\^+\-*/=<>]", RegexOptions.IgnoreCase);
    }

    private static bool ContainsToken(string text, params string[] tokens)
    {
        if (string.IsNullOrWhiteSpace(text) || tokens is null || tokens.Length == 0)
            return false;

        foreach (var token in tokens)
        {
            if (string.IsNullOrWhiteSpace(token))
                continue;

            if (Regex.IsMatch(text, $@"\b{Regex.Escape(token)}\b", RegexOptions.IgnoreCase))
                return true;
        }

        return false;
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

    private static string NormalizeDrawCommandKey(string? line)
    {
        var raw = (line ?? "").Trim();
        if (raw.Length == 0)
            return "";

        var drawLine = IsDrawLine(raw) ? raw : $"DRAW: {raw}";
        var canonical = CanonicalizeDrawLine(drawLine)
            .Replace("DRAW:", "", StringComparison.OrdinalIgnoreCase)
            .Trim();

        return Regex.Replace(canonical, @"\s+", " ").ToLowerInvariant();
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
