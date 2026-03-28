using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using AiTeacher.Services.Ai;

namespace AiTeacher.Services.Videos;

public sealed class VideoNarrationService : IVideoNarrationService
{
    private const int MaxChunkChars = 2200;
    private const int MinRetryChunkChars = 500;
    private const double MinChunkFillRatio = 0.6;
    private const double SegmentMaxWordMultiplier = 2.35;
    private const double BoundarySegmentMaxWordMultiplier = 2.05;
    private const double SegmentMaxCharMultiplier = 2.7;
    private const double BoundarySegmentMaxCharMultiplier = 2.25;
    private const string AfconvertPath = "/usr/bin/afconvert";
    private static readonly Regex WordRegex = new(@"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?", RegexOptions.Compiled);
    private static readonly Regex DrawNarrationRegex = new(@"\b(draw|drawing|triangle|graph|axes|bar|circle|focus|diagram|picture|plot)\b", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly HashSet<string> SyncStopWords = new(StringComparer.Ordinal)
    {
        "the", "and", "then", "this", "that", "with", "from", "into", "your", "you", "our", "for", "are",
        "was", "were", "have", "has", "had", "let", "lets", "write", "draw", "step", "line", "now", "onto",
        "over", "about", "what", "when", "where", "why", "how", "all", "any", "can", "just", "than", "them",
        "to", "of", "in", "on", "at", "by", "be", "as", "is", "it", "we", "us"
    };
    private static readonly HashSet<string> SyncSingleLetterKeywords = new(StringComparer.Ordinal)
    {
        "x", "y", "a", "b", "c", "m", "n"
    };

    private readonly IWebHostEnvironment _env;
    private readonly IAiSpeechClient _speech;
    private readonly IAiChatClient _chat;
    private readonly ILogger<VideoNarrationService> _logger;

    public VideoNarrationService(
        IWebHostEnvironment env,
        IAiSpeechClient speech,
        IAiChatClient chat,
        ILogger<VideoNarrationService> logger)
    {
        _env = env;
        _speech = speech;
        _chat = chat;
        _logger = logger;
    }

    public async Task<VideoNarrationResult> TryGenerateAudioAsync(
        Guid videoId,
        string script,
        IReadOnlyList<string>? narrationSegments,
        IReadOnlyList<string>? boardLines,
        IReadOnlyList<double>? boardTimings,
        IReadOnlyList<double>? boardTimestampSeconds,
        CancellationToken ct)
    {
        var expectedCount = boardLines?.Count ?? 0;
        var fallbackTimestampSeconds = ValidateTimestampSeconds(boardTimestampSeconds, expectedCount);
        var safeNarrationSegments = ValidateNarrationSegments(narrationSegments, expectedCount);

        if (videoId == Guid.Empty || string.IsNullOrWhiteSpace(script))
            return new VideoNarrationResult(null, fallbackTimestampSeconds, safeNarrationSegments);

        try
        {
            var narrationText = script.Trim();
            var safeBoardLines = (boardLines ?? Array.Empty<string>())
                .Select(line => (line ?? "").Trim())
                .Where(line => line.Length > 0)
                .ToList();
            var safeBoardTimings = ValidateTimingFractions(boardTimings, safeBoardLines.Count);

            var resolvedSegments = safeBoardLines.Count == 0
                ? new List<string> { narrationText }
                : await ResolveNarrationSegmentsAsync(
                    narrationText,
                    safeNarrationSegments,
                    safeBoardLines,
                    safeBoardTimings,
                    ct);

            if (resolvedSegments.Count == 0)
                resolvedSegments = new List<string> { narrationText };

            var singlePassResult = await TryGenerateSinglePassAudioAsync(
                videoId,
                narrationText,
                resolvedSegments,
                safeBoardLines,
                safeBoardTimings,
                fallbackTimestampSeconds,
                ct);
            if (singlePassResult is not null)
                return singlePassResult;

            var synthesizedSegments = new List<SynthesizedSegment>(resolvedSegments.Count);
            for (var i = 0; i < resolvedSegments.Count; i++)
            {
                var segmentText = resolvedSegments[i];
                var wavBytes = await SynthesizeSegmentAsync(segmentText, ct);
                if (wavBytes.Length == 0)
                    return new VideoNarrationResult(null, fallbackTimestampSeconds, safeNarrationSegments);

                if (!TryReadWavInfo(wavBytes, out var wavInfo))
                {
                    _logger.LogWarning("Generated narration segment {SegmentIndex} could not be parsed as WAV audio.", i);
                    return new VideoNarrationResult(null, fallbackTimestampSeconds, safeNarrationSegments);
                }

                var gapAfterSeconds = (i + 1) < resolvedSegments.Count
                    ? GetGapAfterSeconds(segmentText)
                    : 0.0;

                synthesizedSegments.Add(new SynthesizedSegment(wavBytes, wavInfo, gapAfterSeconds));
            }

            var wav = ConcatenateWavSegments(synthesizedSegments);
            if (wav.Length == 0)
                return new VideoNarrationResult(null, fallbackTimestampSeconds, safeNarrationSegments);

            var relativeUrl = await WriteNarrationAudioAsync(videoId, wav, ct);

            var segmentsCoverBoard = safeBoardLines.Count == resolvedSegments.Count;
            var segmentsAlignToBoard = segmentsCoverBoard &&
                SegmentsAlignToBoardLines(resolvedSegments, safeBoardLines);
            var canUseRecoveredSegmentTiming = segmentsCoverBoard && segmentsAlignToBoard;
            var durationSeconds = GetTotalDurationSeconds(synthesizedSegments);
            var alignedTimestampSeconds = canUseRecoveredSegmentTiming
                ? BuildExactTimestampSeconds(synthesizedSegments)
                : ScaleFractionsToSeconds(safeBoardTimings, safeBoardLines.Count, durationSeconds);

            var returnedSegments = canUseRecoveredSegmentTiming
                ? resolvedSegments
                : new List<string>();

            return new VideoNarrationResult(relativeUrl, alignedTimestampSeconds, returnedSegments);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to generate narration audio for video {VideoId}", videoId);
            return new VideoNarrationResult(null, fallbackTimestampSeconds, safeNarrationSegments);
        }
    }

    private async Task<VideoNarrationResult?> TryGenerateSinglePassAudioAsync(
        Guid videoId,
        string narration,
        IReadOnlyList<string> resolvedSegments,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<double> boardTimings,
        IReadOnlyList<double> fallbackTimestampSeconds,
        CancellationToken ct)
    {
        if (boardLines.Count == 0 ||
            resolvedSegments.Count != boardLines.Count ||
            !SegmentsAlignToBoardLines(resolvedSegments, boardLines))
        {
            return null;
        }

        var wavBytes = await SynthesizeSegmentAsync(narration, ct);
        if (wavBytes.Length == 0 || !TryReadWavInfo(wavBytes, out _))
            return null;

        var wordTimings = await _speech.TryTranscribeWordTimingsAsync(wavBytes, narration, ct);
        var exactTimestampSeconds = BuildTimestampSecondsFromWordTimings(resolvedSegments, wordTimings);
        if (exactTimestampSeconds.Count != boardLines.Count)
            return null;

        var relativeUrl = await WriteNarrationAudioAsync(videoId, wavBytes, ct);
        return new VideoNarrationResult(relativeUrl, exactTimestampSeconds, resolvedSegments.ToList());
    }

    private async Task<List<string>> ResolveNarrationSegmentsAsync(
        string narration,
        IReadOnlyList<string> providedSegments,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<double> boardTimings,
        CancellationToken ct)
    {
        if (boardLines.Count == 0 || string.IsNullOrWhiteSpace(narration))
            return new List<string>();

        var providedSegmentsAreReliable = SegmentsAreReliable(providedSegments, narration, boardLines.Count);
        var providedSegmentsAlign = SegmentsAlignToBoardLines(providedSegments, boardLines);
        if (providedSegmentsAreReliable && providedSegmentsAlign)
            return providedSegments.Select(segment => segment.Trim()).ToList();

        if (providedSegments.Count == boardLines.Count && SegmentsCoverNarration(providedSegments, narration, boardLines.Count))
        {
            if (!providedSegmentsAreReliable)
            {
                _logger.LogInformation(
                    "Rebuilding narration segments for {BoardLineCount} board lines because the provided spoken beats are too imbalanced for sync.",
                    boardLines.Count);
            }
            else if (!providedSegmentsAlign)
            {
                _logger.LogInformation(
                    "Rebuilding narration segments for {BoardLineCount} board lines because the provided spoken beats drift from the board lines.",
                    boardLines.Count);
            }
        }

        var rebuiltSegments = await BuildNarrationSegmentsAsync(narration, boardLines, boardTimings, ct);
        if (rebuiltSegments.Count == boardLines.Count)
            return rebuiltSegments;

        return new List<string>();
    }

    private async Task<List<string>> BuildNarrationSegmentsAsync(
        string narration,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<double> boardTimings,
        CancellationToken ct)
    {
        if (boardLines.Count == 0 || string.IsNullOrWhiteSpace(narration))
            return new List<string>();

        var modelSegments = await TrySegmentWithModelAsync(narration, boardLines, boardTimings, ct);
        if (SegmentsAreReliable(modelSegments, narration, boardLines.Count) &&
            SegmentsAlignToBoardLines(modelSegments, boardLines))
            return modelSegments;

        var heuristicSegments = HeuristicSegmentNarration(narration, boardLines.Count, boardTimings);
        if (SegmentsAreReliable(heuristicSegments, narration, boardLines.Count) &&
            SegmentsAlignToBoardLines(heuristicSegments, boardLines))
            return heuristicSegments;

        var fallbackSegments = SplitEvenlyByWords(narration, boardLines.Count);
        if (SegmentsCoverNarration(fallbackSegments, narration, boardLines.Count) &&
            SegmentsAlignToBoardLines(fallbackSegments, boardLines))
        {
            return fallbackSegments;
        }

        return new List<string>();
    }

    private async Task<List<string>> TrySegmentWithModelAsync(
        string narration,
        IReadOnlyList<string> boardLines,
        IReadOnlyList<double> boardTimings,
        CancellationToken ct)
    {
        try
        {
            const string systemPrompt =
                "You partition lesson narration into contiguous spoken segments for audio production. " +
                "Do not rewrite, add, remove, or paraphrase words. Return JSON only.";

            var totalWords = Math.Max(1, TokenizeWords(narration).Count);
            var targetWordsPerSegment = Math.Max(10, (int)Math.Round(totalWords / (double)Math.Max(1, boardLines.Count)));
            var maxWordsPerSegment = Math.Max(28, (int)Math.Ceiling(targetWordsPerSegment * 1.9));

            var lines = boardLines
                .Select((line, index) =>
                {
                    var timingHint = boardTimings.Count == boardLines.Count
                        ? $" (~{Math.Round(boardTimings[index] * 100)}%)"
                        : "";
                    return $"{index + 1}. {line}{timingHint}";
                });

            var userPrompt =
                $"Partition the narration below into exactly {boardLines.Count} contiguous segments.\n\n" +
                "Rules:\n" +
                "- Each segment must be copied from the narration in order.\n" +
                "- Together the segments must cover the full narration exactly once.\n" +
                "- Segment i must align semantically to board line i.\n" +
                "- Each segment should cover only the words spoken while board line i is being written.\n" +
                "- Prefer natural clause or sentence boundaries when possible.\n" +
                $"- Aim for about {targetWordsPerSegment} words per segment when possible; avoid segments above about {maxWordsPerSegment} words unless the exact narration forces it.\n" +
                "- Do not lump a whole example, intro, or outro into one segment across multiple board lines.\n" +
                "- Return valid JSON in the shape {\"segments\":[\"...\"]}.\n\n" +
                "Board lines:\n" +
                string.Join('\n', lines) +
                "\n\nNarration:\n" +
                narration;

            var json = await _chat.CompleteAsync(systemPrompt, userPrompt, ct);
            return ParseSegmentsFromJson(json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogDebug(ex, "Narration segmentation fallback engaged.");
            return new List<string>();
        }
    }

    private static List<string> ParseSegmentsFromJson(string json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new List<string>();

        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("segments", out var segmentsElement) ||
                segmentsElement.ValueKind != JsonValueKind.Array)
            {
                return new List<string>();
            }

            return segmentsElement
                .EnumerateArray()
                .Select(x => x.GetString()?.Trim() ?? "")
                .Where(x => x.Length > 0)
                .ToList();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    private static bool SegmentsAreReliable(IReadOnlyList<string> segments, string narration, int expectedCount)
    {
        if (!SegmentsCoverNarration(segments, narration, expectedCount))
            return false;

        if (segments.Count <= 1)
            return true;

        var wordCounts = segments
            .Select(segment => TokenizeWords(segment).Count)
            .ToList();
        if (wordCounts.Any(count => count <= 0))
            return false;

        var charCounts = segments
            .Select(segment => (segment ?? "").Trim().Length)
            .ToList();

        var avgWords = wordCounts.Average();
        var avgChars = charCounts.Average();
        var medianWords = Median(wordCounts);

        var maxWordsPerSegment = Math.Max(38.0, Math.Max(avgWords * SegmentMaxWordMultiplier, medianWords * 2.5));
        var boundaryMaxWords = Math.Max(46.0, Math.Max(avgWords * BoundarySegmentMaxWordMultiplier, medianWords * 2.2));
        var maxCharsPerSegment = Math.Max(240.0, avgChars * SegmentMaxCharMultiplier);
        var boundaryMaxChars = Math.Max(300.0, avgChars * BoundarySegmentMaxCharMultiplier);
        var allowedOversizedSegments = Math.Max(1, expectedCount / 10);
        var oversizedSegments = 0;

        for (var i = 0; i < segments.Count; i++)
        {
            var wordCount = wordCounts[i];
            var charCount = charCounts[i];

            var isOversized =
                wordCount > maxWordsPerSegment ||
                charCount > maxCharsPerSegment;
            if (isOversized)
                oversizedSegments++;

            if ((i == 0 || i == segments.Count - 1) &&
                (wordCount > boundaryMaxWords ||
                 charCount > boundaryMaxChars))
            {
                return false;
            }
        }

        return oversizedSegments <= allowedOversizedSegments;
    }

    private static bool SegmentsAlignToBoardLines(IReadOnlyList<string> segments, IReadOnlyList<string> boardLines)
    {
        if (segments.Count == 0 || segments.Count != boardLines.Count)
            return false;

        var aligned = 0;
        var introAligned = 0;
        var introWindow = Math.Min(10, boardLines.Count);
        for (var i = 0; i < boardLines.Count; i++)
        {
            if (!BoardLineMatchesNarrationSegment(boardLines[i], segments[i]))
                continue;

            aligned++;
            if (i < introWindow)
                introAligned++;
        }

        if (introWindow <= 0)
            return false;

        var alignedRatio = aligned / (double)boardLines.Count;
        var introRatio = introAligned / (double)introWindow;
        return alignedRatio >= 0.72 && introRatio >= 0.6;
    }

    private static int CountAlignedBoardLines(IReadOnlyList<string> segments, IReadOnlyList<string> boardLines)
    {
        if (segments.Count == 0 || segments.Count != boardLines.Count)
            return 0;

        var aligned = 0;
        for (var i = 0; i < boardLines.Count; i++)
        {
            if (BoardLineMatchesNarrationSegment(boardLines[i], segments[i]))
                aligned++;
        }

        return aligned;
    }

    private static bool BoardLineMatchesNarrationSegment(string line, string segment)
    {
        var boardLine = (line ?? "").Trim();
        var narration = (segment ?? "").Trim();
        if (boardLine.Length == 0 || narration.Length == 0)
            return false;

        var lineKeywords = ExtractSyncKeywords(boardLine);
        if (lineKeywords.Count == 0)
            return false;

        var narrationKeywords = ExtractSyncKeywords(narration);
        var narrationKeywordSet = new HashSet<string>(narrationKeywords, StringComparer.Ordinal);
        var overlap = lineKeywords.Count(keyword => narrationKeywordSet.Contains(keyword));

        if (boardLine.StartsWith("DRAW", StringComparison.OrdinalIgnoreCase))
        {
            var focusMatchers = new List<string[]>();
            if (boardLine.Contains("focus", StringComparison.OrdinalIgnoreCase))
            {
                if (boardLine.Contains("theta", StringComparison.OrdinalIgnoreCase) || boardLine.Contains("θ", StringComparison.Ordinal))
                    focusMatchers.Add(new[] { "theta", "θ", "angle" });
                if (boardLine.Contains("right angle", StringComparison.OrdinalIgnoreCase))
                    focusMatchers.Add(new[] { "right angle", "90", "90-degree", "ninety-degree" });
                if (Regex.IsMatch(boardLine, @"\bhyp(?:otenuse)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "hyp", "hypotenuse", "longest side" });
                if (Regex.IsMatch(boardLine, @"\bopp(?:osite)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "opp", "opposite" });
                if (Regex.IsMatch(boardLine, @"\badj(?:acent)?\b", RegexOptions.IgnoreCase))
                    focusMatchers.Add(new[] { "adj", "adjacent" });
            }

            if (focusMatchers.Count > 0)
                return focusMatchers.Any(group => group.Any(token => narration.Contains(token, StringComparison.OrdinalIgnoreCase)));

            return overlap >= 1 || DrawNarrationRegex.IsMatch(narration);
        }

        var requiredOverlap = lineKeywords.Count >= 4 ? 2 : 1;
        return overlap >= requiredOverlap;
    }

    private static List<string> ExtractSyncKeywords(string text)
    {
        var tokens = TokenizeWords(text);
        if (tokens.Count == 0)
            return new List<string>();

        var keywords = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var token in tokens)
        {
            var normalized = NormalizeSyncWord(token);
            var isNumber = normalized.Any(char.IsDigit);
            if (!isNumber && normalized.Length <= 1 && !SyncSingleLetterKeywords.Contains(normalized))
                continue;
            if (SyncStopWords.Contains(normalized) || !seen.Add(normalized))
                continue;

            keywords.Add(normalized);
            if (keywords.Count >= 8)
                break;
        }

        return keywords;
    }

    private static double Median(IReadOnlyList<int> values)
    {
        if (values.Count == 0)
            return 0;

        var ordered = values.OrderBy(v => v).ToArray();
        var mid = ordered.Length / 2;
        return ordered.Length % 2 == 0
            ? (ordered[mid - 1] + ordered[mid]) / 2.0
            : ordered[mid];
    }

    private static bool SegmentsCoverNarration(IReadOnlyList<string> segments, string narration, int expectedCount)
    {
        if (expectedCount <= 0)
            return segments.Count == 0;

        if (segments.Count != expectedCount || segments.Any(s => string.IsNullOrWhiteSpace(s)))
            return false;

        var narrationTokens = TokenizeWords(narration);
        var segmentTokens = segments.SelectMany(TokenizeWords).ToList();
        if (narrationTokens.Count == 0)
            return false;

        if (narrationTokens.Count != segmentTokens.Count)
            return false;

        for (var i = 0; i < narrationTokens.Count; i++)
        {
            if (!string.Equals(narrationTokens[i], segmentTokens[i], StringComparison.Ordinal))
                return false;
        }

        return true;
    }

    private static List<string> HeuristicSegmentNarration(string narration, int segmentCount, IReadOnlyList<double> boardTimings)
    {
        if (segmentCount <= 0 || string.IsNullOrWhiteSpace(narration))
            return new List<string>();

        if (segmentCount == 1)
            return new List<string> { narration.Trim() };

        var text = narration.Trim();
        var boundaries = new List<int> { 0 };
        for (var i = 1; i < segmentCount; i++)
        {
            var targetFraction = boardTimings.Count == segmentCount
                ? Math.Clamp(boardTimings[i], 0.0, 1.0)
                : (double)i / segmentCount;
            var targetIndex = (int)Math.Round(text.Length * targetFraction);
            targetIndex = Math.Clamp(targetIndex, 1, Math.Max(1, text.Length - 1));
            boundaries.Add(FindBoundaryNear(text, targetIndex));
        }
        boundaries.Add(text.Length);

        var segments = new List<string>(segmentCount);
        for (var i = 0; i < segmentCount; i++)
        {
            var start = boundaries[i];
            var end = boundaries[i + 1];
            if (end <= start)
                end = Math.Min(text.Length, start + Math.Max(1, text.Length / segmentCount));

            var segment = text[start..Math.Min(text.Length, end)].Trim();
            if (segment.Length == 0)
                return SplitEvenlyByWords(text, segmentCount);
            segments.Add(segment);
        }

        return segments;
    }

    private static int FindBoundaryNear(string text, int targetIndex)
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

    private static List<string> SplitEvenlyByWords(string narration, int segmentCount)
    {
        if (segmentCount <= 0)
            return new List<string>();

        var text = narration.Trim();
        if (text.Length == 0)
            return new List<string>();

        var words = WordRegex.Matches(text)
            .Cast<Match>()
            .ToList();
        if (words.Count == 0)
            return new List<string>();

        if (segmentCount == 1)
            return new List<string> { text };

        var boundaries = new List<int>(segmentCount + 1) { 0 };
        var cursor = 0;
        for (var i = 0; i < segmentCount - 1; i++)
        {
            var remainingSegments = segmentCount - i;
            var remainingWords = words.Count - cursor;
            var take = (int)Math.Ceiling(remainingWords / (double)remainingSegments);
            cursor = Math.Min(words.Count - 1, cursor + take);

            var nextWordIndex = words[cursor].Index;
            var boundary = FindBoundaryNear(text, nextWordIndex);
            if (boundary <= boundaries[^1])
                boundary = nextWordIndex;
            boundaries.Add(boundary);
        }
        boundaries.Add(text.Length);

        var chunks = new List<string>(segmentCount);
        for (var i = 0; i < segmentCount; i++)
        {
            var start = boundaries[i];
            var end = boundaries[i + 1];
            if (end <= start)
                end = Math.Min(text.Length, Math.Max(start + 1, start + (text.Length / Math.Max(1, segmentCount))));

            var chunk = text[start..Math.Min(text.Length, end)].Trim();
            if (chunk.Length == 0)
                return new List<string>();

            chunks.Add(chunk);
        }

        return chunks;
    }

    private async Task<byte[]> SynthesizeSegmentAsync(string segmentText, CancellationToken ct)
    {
        var trimmed = segmentText.Trim();
        if (trimmed.Length == 0)
            return Array.Empty<byte>();

        var parts = new List<byte[]>();
        foreach (var chunk in SplitIntoChunks(trimmed, MaxChunkChars))
        {
            var chunkParts = await SynthesizeChunkWithRetryAsync(chunk, ct);
            if (chunkParts.Count == 0)
                return Array.Empty<byte>();
            parts.AddRange(chunkParts);
        }

        return ConcatenateWavParts(parts);
    }

    private async Task<List<byte[]>> SynthesizeChunkWithRetryAsync(string chunk, CancellationToken ct)
    {
        try
        {
            var audioPart = await _speech.SynthesizeWavAsync(chunk, ct);
            if (audioPart is null || audioPart.Length == 0)
                return new List<byte[]>();

            var wavPart = await EnsureWavAudioAsync(audioPart, ct);
            if (wavPart.Length == 0)
                return new List<byte[]>();

            return new List<byte[]> { wavPart };
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            if (chunk.Length <= MinRetryChunkChars)
                throw;

            var nextMaxChars = Math.Max(MinRetryChunkChars, chunk.Length / 2);
            if (nextMaxChars >= chunk.Length)
                nextMaxChars = Math.Max(120, chunk.Length - 1);

            var smallerChunks = SplitIntoChunks(chunk, nextMaxChars);
            if (smallerChunks.Count <= 1)
                throw;

            _logger.LogWarning(
                "TTS chunk timed out at {ChunkChars} chars. Retrying as {RetryChunkCount} smaller chunks (max {RetryChunkChars} chars).",
                chunk.Length,
                smallerChunks.Count,
                nextMaxChars);

            var parts = new List<byte[]>();
            foreach (var smallerChunk in smallerChunks)
            {
                var nestedParts = await SynthesizeChunkWithRetryAsync(smallerChunk, ct);
                if (nestedParts.Count == 0)
                    return new List<byte[]>();
                parts.AddRange(nestedParts);
            }

            return parts;
        }
    }

    private async Task<byte[]> EnsureWavAudioAsync(byte[] audioBytes, CancellationToken ct)
    {
        if (audioBytes.Length == 0)
            return Array.Empty<byte>();

        if (TryReadWavInfo(audioBytes, out _))
            return audioBytes;

        var normalized = await TryNormalizeToWavAsync(audioBytes, ct);
        if (normalized.Length > 0 && TryReadWavInfo(normalized, out _))
        {
            _logger.LogInformation(
                "Normalized narration chunk to WAV using afconvert. Source hint: {Hint}.",
                DescribeAudioBytes(audioBytes));
            return normalized;
        }

        _logger.LogWarning(
            "Narration chunk was not valid WAV and could not be normalized. Source hint: {Hint}.",
            DescribeAudioBytes(audioBytes));
        return Array.Empty<byte>();
    }

    private async Task<byte[]> TryNormalizeToWavAsync(byte[] audioBytes, CancellationToken ct)
    {
        if (!File.Exists(AfconvertPath))
            return Array.Empty<byte>();

        var tempDir = Path.Combine(Path.GetTempPath(), "ai-teacher-audio");
        Directory.CreateDirectory(tempDir);

        var extension = DetectLikelyAudioExtension(audioBytes);
        var inputPath = Path.Combine(tempDir, $"{Guid.NewGuid():N}{extension}");
        var outputPath = Path.Combine(tempDir, $"{Guid.NewGuid():N}.wav");

        try
        {
            await File.WriteAllBytesAsync(inputPath, audioBytes, ct);

            var startInfo = new ProcessStartInfo
            {
                FileName = AfconvertPath,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false
            };
            startInfo.ArgumentList.Add("-f");
            startInfo.ArgumentList.Add("WAVE");
            startInfo.ArgumentList.Add("-d");
            startInfo.ArgumentList.Add("LEI16");
            startInfo.ArgumentList.Add("-c");
            startInfo.ArgumentList.Add("1");
            startInfo.ArgumentList.Add("-r");
            startInfo.ArgumentList.Add("24000");
            startInfo.ArgumentList.Add(inputPath);
            startInfo.ArgumentList.Add(outputPath);

            using var process = new Process { StartInfo = startInfo };
            process.Start();
            var stdOutTask = process.StandardOutput.ReadToEndAsync();
            var stdErrTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync(ct);
            var stdOut = await stdOutTask;
            var stdErr = await stdErrTask;

            if (process.ExitCode != 0 || !File.Exists(outputPath))
            {
                _logger.LogWarning(
                    "afconvert failed while normalizing narration audio. ExitCode={ExitCode}. stdout={StdOut}. stderr={StdErr}",
                    process.ExitCode,
                    TruncateForLog(stdOut),
                    TruncateForLog(stdErr));
                return Array.Empty<byte>();
            }

            return await File.ReadAllBytesAsync(outputPath, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to normalize narration audio with afconvert.");
            return Array.Empty<byte>();
        }
        finally
        {
            TryDeleteFile(inputPath);
            TryDeleteFile(outputPath);
        }
    }

    private static List<double> ResolveBoardTimestampSeconds(
        IReadOnlyList<SynthesizedSegment> synthesizedSegments,
        IReadOnlyList<double> boardTimings,
        IReadOnlyList<double> existingTimestampSeconds,
        int expectedCount)
    {
        if (expectedCount <= 0)
            return new List<double>();

        if (synthesizedSegments.Count == expectedCount)
            return BuildExactTimestampSeconds(synthesizedSegments);

        var durationSeconds = GetTotalDurationSeconds(synthesizedSegments);
        var scaledExisting = ScaleTimestampSeconds(existingTimestampSeconds, expectedCount, durationSeconds);
        if (scaledExisting.Count == expectedCount)
            return scaledExisting;

        return ScaleFractionsToSeconds(boardTimings, expectedCount, durationSeconds);
    }

    private static List<double> BuildTimestampSecondsFromWordTimings(
        IReadOnlyList<string> segments,
        IReadOnlyList<AiSpeechWordTiming> wordTimings)
    {
        if (segments.Count == 0 || wordTimings.Count == 0)
            return new List<double>();

        var segmentTokens = segments
            .Select(TokenizeWords)
            .ToList();
        if (segmentTokens.Any(tokens => tokens.Count == 0))
            return new List<double>();

        var timedWords = wordTimings
            .Select(word => new TimedNarrationWord(NormalizeWord(word.Word), Math.Max(0.0, word.StartSeconds)))
            .Where(word => word.Token.Length > 0)
            .ToList();
        if (timedWords.Count == 0)
            return new List<double>();

        var totalSegmentWords = segmentTokens.Sum(tokens => tokens.Count);
        if (totalSegmentWords <= 0)
            return new List<double>();

        var timestamps = new List<double>(segments.Count);
        var consumedSourceWords = 0;
        var previousAudioIndex = 0;
        var previousSeconds = -0.05;

        for (var i = 0; i < segmentTokens.Count; i++)
        {
            double seconds;
            if (i == 0)
            {
                seconds = timedWords[0].StartSeconds;
            }
            else
            {
                var expectedAudioIndex = EstimateAudioWordIndex(
                    consumedSourceWords,
                    totalSegmentWords,
                    timedWords.Count,
                    previousAudioIndex + 1);
                var matchIndex = FindSegmentStartWordIndex(
                    segmentTokens[i],
                    timedWords,
                    previousAudioIndex + 1,
                    expectedAudioIndex);
                if (matchIndex < 0)
                    matchIndex = expectedAudioIndex;

                matchIndex = Math.Clamp(matchIndex, 0, timedWords.Count - 1);
                previousAudioIndex = matchIndex;
                seconds = timedWords[matchIndex].StartSeconds;
            }

            seconds = Math.Max(previousSeconds + 0.05, Math.Max(0.0, seconds));
            timestamps.Add(seconds);
            previousSeconds = seconds;
            consumedSourceWords += segmentTokens[i].Count;
        }

        return timestamps;
    }

    private static int EstimateAudioWordIndex(int consumedSourceWords, int totalSourceWords, int audioWordCount, int minIndex)
    {
        if (audioWordCount <= 0)
            return 0;

        if (totalSourceWords <= 0)
            return Math.Clamp(minIndex, 0, audioWordCount - 1);

        var progress = Math.Clamp(consumedSourceWords / (double)totalSourceWords, 0.0, 1.0);
        var estimate = (int)Math.Round(progress * Math.Max(0, audioWordCount - 1));
        return Math.Clamp(Math.Max(minIndex, estimate), 0, audioWordCount - 1);
    }

    private static int FindSegmentStartWordIndex(
        IReadOnlyList<string> segmentTokens,
        IReadOnlyList<TimedNarrationWord> timedWords,
        int minIndex,
        int expectedIndex)
    {
        if (segmentTokens.Count == 0 || timedWords.Count == 0 || minIndex >= timedWords.Count)
            return -1;

        var safeMinIndex = Math.Max(0, minIndex);
        var safeExpectedIndex = Math.Clamp(expectedIndex, safeMinIndex, timedWords.Count - 1);
        var anchorLengths = new[] { 6, 5, 4, 3, 2, 1 };
        var windows = new[] { 18, 48, 120, int.MaxValue };

        foreach (var window in windows)
        {
            var searchStart = window == int.MaxValue
                ? safeMinIndex
                : Math.Max(safeMinIndex, safeExpectedIndex - window);
            var searchEnd = window == int.MaxValue
                ? timedWords.Count - 1
                : Math.Min(timedWords.Count - 1, safeExpectedIndex + window);

            foreach (var anchorLength in anchorLengths)
            {
                if (segmentTokens.Count < anchorLength || anchorLength <= 0)
                    continue;

                for (var i = searchStart; i <= searchEnd - anchorLength + 1; i++)
                {
                    var matches = true;
                    for (var j = 0; j < anchorLength; j++)
                    {
                        if (!string.Equals(timedWords[i + j].Token, segmentTokens[j], StringComparison.Ordinal))
                        {
                            matches = false;
                            break;
                        }
                    }

                    if (matches)
                        return i;
                }
            }
        }

        return -1;
    }

    private static List<double> BuildExactTimestampSeconds(IReadOnlyList<SynthesizedSegment> segments)
    {
        var result = new List<double>(segments.Count);
        var cursor = 0.0;

        foreach (var segment in segments)
        {
            result.Add(Math.Max(0.0, cursor));
            cursor += Math.Max(0.0, segment.Info.DurationSeconds);
            cursor += Math.Max(0.0, segment.GapAfterSeconds);
        }

        return result;
    }

    private static double GetTotalDurationSeconds(IReadOnlyList<SynthesizedSegment> segments) =>
        segments.Sum(segment => Math.Max(0.0, segment.Info.DurationSeconds) + Math.Max(0.0, segment.GapAfterSeconds));

    private static List<string> ValidateNarrationSegments(IReadOnlyList<string>? segments, int expectedCount)
    {
        if (segments is null)
            return new List<string>();

        var cleaned = segments
            .Select(segment => (segment ?? "").Trim())
            .Where(segment => segment.Length > 0)
            .ToList();

        if (expectedCount > 0 && cleaned.Count != expectedCount)
            return new List<string>();

        return cleaned;
    }

    private async Task<string> WriteNarrationAudioAsync(Guid videoId, byte[] wavBytes, CancellationToken ct)
    {
        var webRoot = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(webRoot))
            webRoot = Path.Combine(_env.ContentRootPath, "wwwroot");

        var relativeUrl = $"/generated/audio/{videoId}.wav";
        var filePath = Path.Combine(webRoot, "generated", "audio", $"{videoId}.wav");
        Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
        await File.WriteAllBytesAsync(filePath, wavBytes, ct);
        return relativeUrl;
    }

    private static List<double> ScaleTimestampSeconds(IReadOnlyList<double> timestampSeconds, int expectedCount, double durationSeconds)
    {
        var validated = ValidateTimestampSeconds(timestampSeconds, expectedCount);
        if (validated.Count != expectedCount)
            return new List<double>();

        if (!double.IsFinite(durationSeconds) || durationSeconds <= 0)
            return validated;

        var first = validated[0];
        var last = validated[^1];
        var span = last - first;
        if (span <= 0)
            return validated;

        var scale = durationSeconds / span;
        if (!double.IsFinite(scale) || scale <= 0)
            return validated;

        var scaled = new List<double>(expectedCount);
        var previous = -0.05;
        foreach (var seconds in validated)
        {
            var adjusted = Math.Max(previous + 0.05, Math.Max(0.0, (seconds - first) * scale));
            scaled.Add(adjusted);
            previous = adjusted;
        }

        return scaled;
    }

    private static List<double> ScaleFractionsToSeconds(IReadOnlyList<double> timings, int expectedCount, double durationSeconds)
    {
        var validated = ValidateTimingFractions(timings, expectedCount);
        if (validated.Count != expectedCount || !double.IsFinite(durationSeconds) || durationSeconds <= 0)
            return new List<double>();

        var first = validated[0];
        var last = validated[^1];
        var span = last - first;
        if (span <= 0)
            return new List<double>();

        var scaled = new List<double>(expectedCount);
        var previous = -0.05;
        foreach (var fraction in validated)
        {
            var normalized = Math.Clamp((fraction - first) / span, 0.0, 1.0);
            var adjusted = Math.Max(previous + 0.05, normalized * durationSeconds);
            scaled.Add(adjusted);
            previous = adjusted;
        }

        return scaled;
    }

    private static List<double> ValidateTimestampSeconds(IReadOnlyList<double>? seconds, int expectedCount)
    {
        if (expectedCount <= 0 || seconds is null || seconds.Count != expectedCount)
            return new List<double>();

        var result = new List<double>(expectedCount);
        var previous = -1.0;
        foreach (var value in seconds)
        {
            if (!double.IsFinite(value) || value < 0 || value <= previous)
                return new List<double>();
            result.Add(value);
            previous = value;
        }

        return result;
    }

    private static List<double> ValidateTimingFractions(IReadOnlyList<double>? timings, int expectedCount)
    {
        if (expectedCount <= 0 || timings is null || timings.Count != expectedCount)
            return new List<double>();

        var result = new List<double>(expectedCount);
        var previous = -1.0;
        foreach (var value in timings)
        {
            if (!double.IsFinite(value))
                return new List<double>();

            var clamped = Math.Clamp(value, 0.0, 1.0);
            if (clamped <= previous)
                return new List<double>();

            result.Add(clamped);
            previous = clamped;
        }

        return result;
    }

    private static List<string> TokenizeWords(string text) =>
        WordRegex.Matches(NormalizeText(text))
            .Select(m => NormalizeWord(m.Value))
            .Where(token => token.Length > 0)
            .ToList();

    private static string NormalizeText(string text) =>
        (text ?? "")
            .Replace('’', '\'')
            .Replace('‘', '\'')
            .Replace('“', '"')
            .Replace('”', '"');

    private static string NormalizeWord(string word)
    {
        if (string.IsNullOrWhiteSpace(word))
            return "";

        var chars = word
            .ToLowerInvariant()
            .Where(char.IsLetterOrDigit)
            .ToArray();

        return new string(chars);
    }

    private static string NormalizeSyncWord(string word) =>
        NormalizeWord(word) switch
        {
            "sin" => "sine",
            "cos" => "cosine",
            "tan" => "tangent",
            "opp" => "opposite",
            "adj" => "adjacent",
            "hyp" => "hypotenuse",
            "deg" => "degree",
            var normalized => normalized
        };

    private static List<string> SplitIntoChunks(string text, int maxChars)
    {
        var trimmed = text.Trim();
        if (trimmed.Length == 0)
            return new List<string>();

        var chunks = new List<string>();
        var cursor = 0;
        while (cursor < trimmed.Length)
        {
            var chunkEnd = FindChunkEnd(trimmed, cursor, maxChars);
            if (chunkEnd <= cursor)
                chunkEnd = Math.Min(trimmed.Length, cursor + maxChars);

            var chunk = trimmed[cursor..chunkEnd].Trim();
            if (chunk.Length > 0)
                chunks.Add(chunk);

            cursor = chunkEnd;
            while (cursor < trimmed.Length && char.IsWhiteSpace(trimmed[cursor]))
                cursor++;
        }

        return chunks;
    }

    private static int FindChunkEnd(string text, int startIndex, int maxChars)
    {
        var maxEnd = Math.Min(text.Length, startIndex + maxChars);
        if (maxEnd >= text.Length)
            return text.Length;

        var minEnd = startIndex + (int)Math.Round(maxChars * MinChunkFillRatio);
        if (minEnd > maxEnd)
            minEnd = maxEnd;

        var window = text[minEnd..maxEnd];
        var delimiters = new[] { "\n\n", ". ", "? ", "! ", "; ", ": ", "\n", " " };
        foreach (var delimiter in delimiters)
        {
            var idx = window.LastIndexOf(delimiter, StringComparison.Ordinal);
            if (idx >= 0)
                return minEnd + idx + delimiter.Length;
        }

        return maxEnd;
    }

    private static string DetectLikelyAudioExtension(byte[] audioBytes)
    {
        if (audioBytes.Length >= 12 &&
            audioBytes[0] == (byte)'R' &&
            audioBytes[1] == (byte)'I' &&
            audioBytes[2] == (byte)'F' &&
            audioBytes[3] == (byte)'F' &&
            audioBytes[8] == (byte)'W' &&
            audioBytes[9] == (byte)'A' &&
            audioBytes[10] == (byte)'V' &&
            audioBytes[11] == (byte)'E')
        {
            return ".wav";
        }

        if (audioBytes.Length >= 3 &&
            audioBytes[0] == (byte)'I' &&
            audioBytes[1] == (byte)'D' &&
            audioBytes[2] == (byte)'3')
        {
            return ".mp3";
        }

        if (audioBytes.Length >= 2 &&
            audioBytes[0] == 0xFF &&
            (audioBytes[1] & 0xE0) == 0xE0)
        {
            return ".mp3";
        }

        if (audioBytes.Length >= 4 &&
            audioBytes[0] == (byte)'f' &&
            audioBytes[1] == (byte)'L' &&
            audioBytes[2] == (byte)'a' &&
            audioBytes[3] == (byte)'C')
        {
            return ".flac";
        }

        if (audioBytes.Length >= 4 &&
            audioBytes[0] == (byte)'O' &&
            audioBytes[1] == (byte)'g' &&
            audioBytes[2] == (byte)'g' &&
            audioBytes[3] == (byte)'S')
        {
            return ".ogg";
        }

        if (audioBytes.Length >= 12 &&
            audioBytes[4] == (byte)'f' &&
            audioBytes[5] == (byte)'t' &&
            audioBytes[6] == (byte)'y' &&
            audioBytes[7] == (byte)'p')
        {
            return ".m4a";
        }

        if (audioBytes.Length >= 4 &&
            audioBytes[0] == (byte)'c' &&
            audioBytes[1] == (byte)'a' &&
            audioBytes[2] == (byte)'f' &&
            audioBytes[3] == (byte)'f')
        {
            return ".caf";
        }

        return ".bin";
    }

    private static string DescribeAudioBytes(byte[] audioBytes)
    {
        var extension = DetectLikelyAudioExtension(audioBytes);
        var headerLength = Math.Min(audioBytes.Length, 12);
        var header = Convert.ToHexString(audioBytes, 0, headerLength);
        return $"{extension} bytes={audioBytes.Length} header={header}";
    }

    private static string TruncateForLog(string text)
    {
        var value = (text ?? "").Trim();
        if (value.Length <= 400)
            return value;

        return value[..400];
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            // Ignore temp cleanup failures.
        }
    }

    private static double GetGapAfterSeconds(string text)
    {
        var trimmed = (text ?? "").Trim();
        if (trimmed.Length == 0)
            return 0.08;

        return trimmed[^1] switch
        {
            '.' or '?' or '!' => 0.16,
            ';' or ':' => 0.12,
            ',' => 0.09,
            _ => 0.07
        };
    }

    private static byte[] ConcatenateWavParts(IReadOnlyList<byte[]> parts)
    {
        if (parts.Count == 0)
            return Array.Empty<byte>();

        var synthesized = parts
            .Select(part => new SynthesizedSegment(part, TryGetRequiredWavInfo(part), 0.0))
            .ToList();

        return ConcatenateWavSegments(synthesized);
    }

    private static byte[] ConcatenateWavSegments(IReadOnlyList<SynthesizedSegment> segments)
    {
        if (segments.Count == 0)
            return Array.Empty<byte>();

        var first = segments[0].Info;
        var blockAlign = first.BlockAlign;
        using var data = new MemoryStream();

        foreach (var segment in segments)
        {
            ValidateMatchingFormat(first, segment.Info);
            data.Write(segment.AudioBytes, segment.Info.DataOffset, segment.Info.DataSize);

            var silenceBytes = GetSilenceByteCount(segment.Info, segment.GapAfterSeconds);
            if (silenceBytes <= 0)
                continue;

            var silence = new byte[silenceBytes];
            data.Write(silence, 0, silence.Length);
        }

        return BuildWavFile(first.AudioFormat, first.Channels, first.SampleRate, first.BitsPerSample, blockAlign, data.ToArray());
    }

    private static int GetSilenceByteCount(WavInfo info, double seconds)
    {
        if (!double.IsFinite(seconds) || seconds <= 0)
            return 0;

        var byteCount = (int)Math.Round(seconds * info.ByteRate);
        if (byteCount <= 0)
            return 0;

        var remainder = byteCount % info.BlockAlign;
        if (remainder != 0)
            byteCount += info.BlockAlign - remainder;

        return byteCount;
    }

    private static void ValidateMatchingFormat(WavInfo expected, WavInfo actual)
    {
        if (expected.AudioFormat != actual.AudioFormat ||
            expected.Channels != actual.Channels ||
            expected.SampleRate != actual.SampleRate ||
            expected.BitsPerSample != actual.BitsPerSample)
        {
            throw new InvalidOperationException("Narration segments returned different WAV formats and cannot be concatenated safely.");
        }
    }

    private static byte[] BuildWavFile(
        ushort audioFormat,
        ushort channels,
        uint sampleRate,
        ushort bitsPerSample,
        ushort blockAlign,
        byte[] pcmData)
    {
        var dataSize = pcmData.Length;
        var byteRate = sampleRate * blockAlign;

        using var stream = new MemoryStream(capacity: 44 + dataSize);
        using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true);

        writer.Write(Encoding.ASCII.GetBytes("RIFF"));
        writer.Write(36 + dataSize);
        writer.Write(Encoding.ASCII.GetBytes("WAVE"));
        writer.Write(Encoding.ASCII.GetBytes("fmt "));
        writer.Write(16);
        writer.Write(audioFormat);
        writer.Write(channels);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write(blockAlign);
        writer.Write(bitsPerSample);
        writer.Write(Encoding.ASCII.GetBytes("data"));
        writer.Write(dataSize);
        writer.Write(pcmData);
        writer.Flush();

        return stream.ToArray();
    }

    private static WavInfo TryGetRequiredWavInfo(byte[] wavBytes)
    {
        if (TryReadWavInfo(wavBytes, out var info))
            return info;

        throw new InvalidOperationException("Generated narration could not be parsed as WAV audio.");
    }

    private static bool TryReadWavInfo(byte[] wavBytes, out WavInfo info)
    {
        info = default;
        if (wavBytes is null || wavBytes.Length < 44)
            return false;

        using var stream = new MemoryStream(wavBytes, writable: false);
        using var reader = new BinaryReader(stream, Encoding.ASCII, leaveOpen: true);

        if (!TryReadChunkId(reader, out var riffId) || !string.Equals(riffId, "RIFF", StringComparison.Ordinal))
            return false;

        _ = reader.ReadUInt32();

        if (!TryReadChunkId(reader, out var waveId) || !string.Equals(waveId, "WAVE", StringComparison.Ordinal))
            return false;

        ushort audioFormat = 0;
        ushort channels = 0;
        uint sampleRate = 0;
        ushort bitsPerSample = 0;
        ushort blockAlign = 0;
        int dataOffset = 0;
        int dataSize = 0;

        while (stream.Position + 8 <= stream.Length)
        {
            if (!TryReadChunkId(reader, out var chunkId))
                return false;

            var chunkSize = reader.ReadUInt32();
            if (chunkSize > int.MaxValue)
                return false;

            var chunkStart = stream.Position;
            if (chunkStart + chunkSize > stream.Length)
                return false;

            if (string.Equals(chunkId, "fmt ", StringComparison.Ordinal))
            {
                if (chunkSize < 16)
                    return false;

                audioFormat = reader.ReadUInt16();
                channels = reader.ReadUInt16();
                sampleRate = reader.ReadUInt32();
                _ = reader.ReadUInt32();
                blockAlign = reader.ReadUInt16();
                bitsPerSample = reader.ReadUInt16();
            }
            else if (string.Equals(chunkId, "data", StringComparison.Ordinal))
            {
                dataOffset = (int)stream.Position;
                dataSize = (int)chunkSize;
            }

            stream.Position = chunkStart + chunkSize;
            if ((chunkSize & 1) == 1 && stream.Position < stream.Length)
                stream.Position += 1;
        }

        if (audioFormat == 0 || channels == 0 || sampleRate == 0 || bitsPerSample == 0 || blockAlign == 0 || dataOffset <= 0 || dataSize <= 0)
            return false;

        var byteRate = sampleRate * blockAlign;
        if (byteRate <= 0)
            return false;

        var durationSeconds = dataSize / (double)byteRate;
        info = new WavInfo(audioFormat, channels, sampleRate, bitsPerSample, blockAlign, byteRate, dataOffset, dataSize, durationSeconds);
        return true;
    }

    private static bool TryReadChunkId(BinaryReader reader, out string chunkId)
    {
        var bytes = reader.ReadBytes(4);
        if (bytes.Length != 4)
        {
            chunkId = "";
            return false;
        }

        chunkId = Encoding.ASCII.GetString(bytes);
        return true;
    }

    private sealed record SynthesizedSegment(byte[] AudioBytes, WavInfo Info, double GapAfterSeconds);

    private sealed record TimedNarrationWord(string Token, double StartSeconds);

    private readonly record struct WavInfo(
        ushort AudioFormat,
        ushort Channels,
        uint SampleRate,
        ushort BitsPerSample,
        ushort BlockAlign,
        uint ByteRate,
        int DataOffset,
        int DataSize,
        double DurationSeconds);
}
