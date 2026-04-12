using AiTeacher.Services.Ai;
using AiTeacher.Services.Attempts;
using AiTeacher.Services.Exams;
using AiTeacher.Services.Storage;
using AiTeacher.Services.Videos;
using AiTeacher.Models;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();

builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));

builder.Services.AddSingleton<IAttemptStore, InMemoryAttemptStore>();
builder.Services.AddSingleton<IExamRepository, JsonExamRepository>();
builder.Services.AddSingleton<IVideoJobRepository, JsonVideoJobRepository>();

builder.Services.AddSingleton<StubAiChatClient>();
builder.Services.AddHttpClient<OpenAiChatClient>((sp, client) =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    var timeoutSeconds = options.OpenAi.ChatTimeoutSeconds;
    if (timeoutSeconds <= 0)
        timeoutSeconds = 1200;
    client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
});
builder.Services.AddHttpClient<OpenAiRealtimeClient>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(2);
});
builder.Services.AddSingleton<IAiChatClient>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    return options.UseOpenAi()
        ? sp.GetRequiredService<OpenAiChatClient>()
        : sp.GetRequiredService<StubAiChatClient>();
});

builder.Services.AddSingleton<StubAiSpeechClient>();
builder.Services.AddHttpClient<OpenAiSpeechClient>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(10);
});
builder.Services.AddHttpClient<ElevenLabsSpeechClient>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(10);
});
builder.Services.AddSingleton<IAiSpeechClient>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    var ttsProvider = options.ResolveTtsProvider();

    if (string.Equals(ttsProvider, "ElevenLabs", StringComparison.OrdinalIgnoreCase))
        return sp.GetRequiredService<ElevenLabsSpeechClient>();

    if (string.Equals(ttsProvider, "OpenAI", StringComparison.OrdinalIgnoreCase))
        return sp.GetRequiredService<OpenAiSpeechClient>();

    if (string.Equals(ttsProvider, "Stub", StringComparison.OrdinalIgnoreCase))
        return sp.GetRequiredService<StubAiSpeechClient>();

    return options.UseOpenAi()
        ? sp.GetRequiredService<OpenAiSpeechClient>()
        : sp.GetRequiredService<StubAiSpeechClient>();
});

builder.Services.AddSingleton<IAiTeacherService, AiTeacherService>();
builder.Services.AddSingleton<IVideoNarrationService, VideoNarrationService>();
builder.Services.AddSingleton<RealtimeWhiteboardCoordinator>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();
app.UseAuthorization();

app.MapRazorPages();

app.MapPost("/api/attempts/{attemptId:guid}/questions/{questionId:guid}/explanation",
    async (Guid attemptId, Guid questionId, IAttemptStore attempts, IExamRepository exams, IAiTeacherService ai, CancellationToken ct) =>
    {
        if (!attempts.TryGetAttempt(attemptId, out var attempt))
            return Results.NotFound(new { message = "Attempt not found." });

        if (attempt.ExamId == Guid.Empty)
            return Results.BadRequest(new { message = "Attempt is missing exam id." });

        var exam = await exams.GetByIdAsync(attempt.ExamId, ct);
        if (exam is null)
            return Results.NotFound(new { message = "Exam not found." });

        var question = exam.Questions.FirstOrDefault(q => q.Id == questionId);
        if (question is null)
            return Results.NotFound(new { message = "Question not found." });

        if (attempts.TryGetExplanation(attemptId, questionId, out var cached))
            return Results.Ok(new { explanation = cached });

        attempt.Answers.TryGetValue(questionId, out var studentChoiceIndex);
        var pack = await ai.ExplainQuestionVideoAsync(
            exam,
            question,
            studentChoiceIndex: attempt.Answers.ContainsKey(questionId) ? studentChoiceIndex : null,
            ct);
        attempts.SetExplanation(attemptId, questionId, pack.Narration);
        attempts.SetBoardLines(attemptId, questionId, pack.BoardLines.ToArray());
        attempts.SetBoardTimings(attemptId, questionId, pack.BoardTimings.ToArray());
        attempts.SetBoardTimestampSeconds(attemptId, questionId, pack.BoardTimestampSeconds?.ToArray() ?? Array.Empty<double>());

        return Results.Ok(new { explanation = pack.Narration });
    }).DisableAntiforgery();

app.MapPost("/api/attempts/{attemptId:guid}/questions/{questionId:guid}/video",
    async (
        Guid attemptId,
        Guid questionId,
        IAttemptStore attempts,
        IExamRepository exams,
        IAiTeacherService ai,
        IVideoJobRepository videos,
        IVideoNarrationService narration,
        CancellationToken ct) =>
    {
        if (!attempts.TryGetAttempt(attemptId, out var attempt))
            return Results.NotFound(new { message = "Attempt not found." });

        var exam = await exams.GetByIdAsync(attempt.ExamId, ct);
        if (exam is null)
            return Results.NotFound(new { message = "Exam not found." });

        var question = exam.Questions.FirstOrDefault(q => q.Id == questionId);
        if (question is null)
            return Results.NotFound(new { message = "Question not found." });

        string script;
        List<string> narrationSegments;
        string[] boardLines;
        double[] boardTimings;
        double[] boardTimestampSeconds;

        if (attempts.TryGetExplanation(attemptId, questionId, out var cachedExplanation)
            && attempts.TryGetBoardLines(attemptId, questionId, out var cachedBoardLines)
            && attempts.TryGetBoardTimings(attemptId, questionId, out var cachedBoardTimings)
            && cachedBoardLines.Length > 0)
        {
            script = cachedExplanation;
            narrationSegments = new List<string>();
            boardLines = cachedBoardLines;
            boardTimings = cachedBoardTimings;
            boardTimestampSeconds = attempts.TryGetBoardTimestampSeconds(attemptId, questionId, out var cachedBoardTimestampSeconds)
                ? cachedBoardTimestampSeconds
                : Array.Empty<double>();
        }
        else
        {
            attempt.Answers.TryGetValue(questionId, out var studentChoiceIndex);
            var pack = await ai.ExplainQuestionVideoAsync(
                exam,
                question,
                studentChoiceIndex: attempt.Answers.ContainsKey(questionId) ? studentChoiceIndex : null,
                ct);
            script = pack.Narration;
            narrationSegments = pack.NarrationSegments ?? new List<string>();
            boardLines = pack.BoardLines.ToArray();
            boardTimings = pack.BoardTimings.ToArray();
            boardTimestampSeconds = pack.BoardTimestampSeconds?.ToArray() ?? Array.Empty<double>();

            attempts.SetExplanation(attemptId, questionId, script);
            attempts.SetBoardLines(attemptId, questionId, boardLines);
            attempts.SetBoardTimings(attemptId, questionId, boardTimings);
            attempts.SetBoardTimestampSeconds(attemptId, questionId, boardTimestampSeconds);
        }

        var job = new AiTeacher.Models.VideoJob
        {
            Id = Guid.NewGuid(),
            Title = $"Solution Video: {exam.Title} – Question {exam.Questions.FindIndex(q => q.Id == question.Id) + 1}",
            SourceType = "Solution",
            Script = script,
            NarrationSegments = narrationSegments,
            BoardLines = boardLines.ToList(),
            BoardTimings = boardTimings.ToList(),
            BoardTimestampSeconds = boardTimestampSeconds.ToList(),
            CreatedAtUtc = DateTimeOffset.UtcNow,
        };

        var narrationResult = await narration.TryGenerateAudioAsync(
            job.Id,
            job.Script,
            job.NarrationSegments,
            job.BoardLines,
            job.BoardTimings,
            job.BoardTimestampSeconds,
            ct);
        job.AudioUrl = narrationResult.AudioUrl;
        if (narrationResult.BoardTimestampSeconds.Count == job.BoardLines.Count)
            job.BoardTimestampSeconds = narrationResult.BoardTimestampSeconds.ToList();
        if (narrationResult.NarrationSegments.Count == job.BoardLines.Count)
            job.NarrationSegments = narrationResult.NarrationSegments.ToList();

        await videos.CreateAsync(job, ct);
        return Results.Ok(new { videoId = job.Id, watchUrl = $"/Videos/Watch/{job.Id}" });
    }).DisableAntiforgery();

app.MapPost("/api/videos/{videoId:guid}/upload",
    async (Guid videoId, IFormFile video, IVideoJobRepository videos, IWebHostEnvironment env, CancellationToken ct) =>
    {
        if (videoId == Guid.Empty)
            return Results.BadRequest(new { message = "Invalid video id." });

        if (video is null || video.Length == 0)
            return Results.BadRequest(new { message = "Missing video file." });

        if (video.Length > 150 * 1024 * 1024)
            return Results.BadRequest(new { message = "Video file too large (max 150MB)." });

        var existing = await videos.GetByIdAsync(videoId, ct);
        if (existing is null)
            return Results.NotFound(new { message = "Video job not found." });

        var webRoot = env.WebRootPath;
        if (string.IsNullOrWhiteSpace(webRoot))
            webRoot = Path.Combine(env.ContentRootPath, "wwwroot");

        var dir = Path.Combine(webRoot, "generated", "video");
        Directory.CreateDirectory(dir);

        var filePath = Path.Combine(dir, $"{videoId}.webm");
        await using (var stream = File.Create(filePath))
        {
            await video.CopyToAsync(stream, ct);
        }

        existing.VideoUrl = $"/generated/video/{videoId}.webm";
        await videos.UpdateAsync(existing, ct);

        return Results.Ok(new { videoUrl = existing.VideoUrl, watchUrl = $"/Videos/Watch/{videoId}" });
    }).DisableAntiforgery();

app.MapPost("/api/videos/{videoId:guid}/question",
    async (Guid videoId, VideoQuestionRequest req, IVideoJobRepository videos, IAiTeacherService aiTeacher, IVideoNarrationService narration, CancellationToken ct) =>
    {
        if (videoId == Guid.Empty)
            return Results.BadRequest(new { message = "Invalid video id." });

        var question = (req.Question ?? "").Trim();
        var boardWrittenContent = (req.Board?.WrittenContent ?? "").Trim();
        var drawCommands = (req.Board?.DrawCommands ?? new List<string>())
            .Select(command => (command ?? "").Trim())
            .Where(command => command.Length > 0)
            .ToList();

        if (req.Board is not null && string.IsNullOrWhiteSpace(boardWrittenContent))
            return Results.BadRequest(new { message = "Write your question on the board before asking." });

        if (string.IsNullOrWhiteSpace(question))
            question = boardWrittenContent;

        if (string.IsNullOrWhiteSpace(question))
            return Results.BadRequest(new { message = "Question is required." });

        if (question.Length > 800)
            return Results.BadRequest(new { message = "Question is too long (max 800 characters)." });

        if (boardWrittenContent.Length > 3000)
            return Results.BadRequest(new { message = "Board writing is too long (max 3000 characters)." });

        if (drawCommands.Count > 12)
            return Results.BadRequest(new { message = "Too many board visuals (max 12)." });

        if (drawCommands.Any(command => command.Length > 220))
            return Results.BadRequest(new { message = "Each board visual command must stay under 220 characters." });

        var video = await videos.GetByIdAsync(videoId, ct);
        if (video is null)
            return Results.NotFound(new { message = "Video job not found." });

        var progress = req.Progress is { } p && double.IsFinite(p) ? Math.Clamp(p, 0, 1) : (double?)null;
        var board = req.Board is null
            ? null
            : new VideoQuestionBoardRequest(
                boardWrittenContent,
                drawCommands.Count == 0 ? null : drawCommands);

        var pack = await aiTeacher.AnswerVideoQuestionAsync(video, question, progress, board, ct);
        var narrationResult = await narration.TryGenerateAudioAsync(
            Guid.NewGuid(),
            pack.Narration,
            pack.NarrationSegments,
            pack.BoardLines,
            pack.BoardTimings,
            pack.BoardTimestampSeconds ?? new List<double>(),
            ct);
        return Results.Ok(new
        {
            narration = pack.Narration,
            narrationSegments = narrationResult.NarrationSegments.Count == pack.BoardLines.Count
                ? narrationResult.NarrationSegments
                : pack.NarrationSegments,
            boardLines = pack.BoardLines,
            boardTimings = pack.BoardTimings,
            boardTimestampSeconds = narrationResult.BoardTimestampSeconds.Count == pack.BoardLines.Count
                ? narrationResult.BoardTimestampSeconds
                : pack.BoardTimestampSeconds,
            audioUrl = narrationResult.AudioUrl
        });
    }).DisableAntiforgery();

app.MapPost("/api/realtime-lessons/connect",
    async (HttpRequest httpRequest, string? topic, OpenAiRealtimeClient realtime, CancellationToken ct) =>
    {
        var cleanTopic = (topic ?? "").Trim();
        if (string.IsNullOrWhiteSpace(cleanTopic))
            return Results.BadRequest(new { message = "Enter a lesson topic before starting live mode." });

        string offerSdp;
        using (var reader = new StreamReader(httpRequest.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true))
        {
            offerSdp = await reader.ReadToEndAsync(ct);
        }

        if (string.IsNullOrWhiteSpace(offerSdp))
            return Results.BadRequest(new { message = "Missing WebRTC offer SDP." });

        try
        {
            var answerSdp = await realtime.CreateLessonCallAnswerSdpAsync(offerSdp, cleanTopic, ct);
            return Results.Text(answerSdp, "application/sdp");
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
    }).DisableAntiforgery();

app.MapPost("/api/realtime-lessons/board-sync",
    async (RealtimeBoardSyncRequest request, RealtimeWhiteboardCoordinator coordinator, CancellationToken ct) =>
    {
        var topic = (request.Topic ?? "").Trim();
        if (string.IsNullOrWhiteSpace(topic))
            return Results.BadRequest(new { message = "Missing lesson topic." });

        var spokenChunk = (request.AssistantTranscriptChunk ?? "").Trim();
        if (string.IsNullOrWhiteSpace(spokenChunk))
            return Results.Ok(new RealtimeBoardSyncResponse(Array.Empty<string>()));

        try
        {
            var lines = await coordinator.BuildBoardUpdatesAsync(request, ct);
            return Results.Ok(new RealtimeBoardSyncResponse(lines.ToArray()));
        }
        catch (InvalidOperationException ex)
        {
            return Results.BadRequest(new { message = ex.Message });
        }
    }).DisableAntiforgery();

app.Run();
