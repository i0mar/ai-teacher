using AiTeacher.Services.Ai;
using AiTeacher.Services.Attempts;
using AiTeacher.Services.Exams;
using AiTeacher.Services.Storage;
using AiTeacher.Services.Videos;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorPages();

builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection("Storage"));

builder.Services.AddSingleton<IAttemptStore, InMemoryAttemptStore>();
builder.Services.AddSingleton<IExamRepository, JsonExamRepository>();
builder.Services.AddSingleton<IVideoJobRepository, JsonVideoJobRepository>();

builder.Services.AddSingleton<StubAiChatClient>();
builder.Services.AddHttpClient<OpenAiChatClient>();
builder.Services.AddSingleton<IAiChatClient>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    var provider = options.Provider?.Trim() ?? "Stub";
    return provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
        ? sp.GetRequiredService<OpenAiChatClient>()
        : sp.GetRequiredService<StubAiChatClient>();
});

builder.Services.AddSingleton<StubAiSpeechClient>();
builder.Services.AddHttpClient<OpenAiSpeechClient>();
builder.Services.AddSingleton<IAiSpeechClient>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    var provider = options.Provider?.Trim() ?? "Stub";
    return provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
        ? sp.GetRequiredService<OpenAiSpeechClient>()
        : sp.GetRequiredService<StubAiSpeechClient>();
});

builder.Services.AddSingleton<StubAiImageClient>();
builder.Services.AddHttpClient<OpenAiImageClient>();
builder.Services.AddSingleton<IAiImageClient>(sp =>
{
    var options = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    var provider = options.Provider?.Trim() ?? "Stub";
    return provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
        ? sp.GetRequiredService<OpenAiImageClient>()
        : sp.GetRequiredService<StubAiImageClient>();
});

builder.Services.AddSingleton<IAiTeacherService, AiTeacherService>();
builder.Services.AddSingleton<IVideoNarrationService, VideoNarrationService>();
builder.Services.AddSingleton<IAvatarService, AvatarService>();

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

        return Results.Ok(new { explanation = pack.Narration });
    }).DisableAntiforgery();

app.MapPost("/api/attempts/{attemptId:guid}/questions/{questionId:guid}/video",
    async (Guid attemptId, Guid questionId, IAttemptStore attempts, IExamRepository exams, IAiTeacherService ai, IVideoJobRepository videos, IVideoNarrationService narration, IAvatarService avatars, CancellationToken ct) =>
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
        string[] boardLines;
        double[] boardTimings;

        if (attempts.TryGetExplanation(attemptId, questionId, out var cachedExplanation)
            && attempts.TryGetBoardLines(attemptId, questionId, out var cachedBoardLines)
            && attempts.TryGetBoardTimings(attemptId, questionId, out var cachedBoardTimings)
            && cachedBoardLines.Length > 0)
        {
            script = cachedExplanation;
            boardLines = cachedBoardLines;
            boardTimings = cachedBoardTimings;
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
            boardLines = pack.BoardLines.ToArray();
            boardTimings = pack.BoardTimings.ToArray();

            attempts.SetExplanation(attemptId, questionId, script);
            attempts.SetBoardLines(attemptId, questionId, boardLines);
            attempts.SetBoardTimings(attemptId, questionId, boardTimings);
        }

        var job = new AiTeacher.Models.VideoJob
        {
            Id = Guid.NewGuid(),
            Title = $"Solution Video: {exam.Title} – Question {exam.Questions.FindIndex(q => q.Id == question.Id) + 1}",
            SourceType = "Solution",
            Script = script,
            BoardLines = boardLines.ToList(),
            BoardTimings = boardTimings.ToList(),
            CreatedAtUtc = DateTimeOffset.UtcNow,
        };

        job.AvatarUrl = await avatars.EnsureTeacherAvatarAsync(ct);
        job.AudioUrl = await narration.TryGenerateAudioAsync(job.Id, job.Script, ct);
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
        if (string.IsNullOrWhiteSpace(question))
            return Results.BadRequest(new { message = "Question is required." });

        if (question.Length > 800)
            return Results.BadRequest(new { message = "Question is too long (max 800 characters)." });

        var video = await videos.GetByIdAsync(videoId, ct);
        if (video is null)
            return Results.NotFound(new { message = "Video job not found." });

        var progress = req.Progress is { } p && double.IsFinite(p) ? Math.Clamp(p, 0, 1) : (double?)null;
        var pack = await aiTeacher.AnswerVideoQuestionAsync(video, question, progress, ct);
        var audioUrl = await narration.TryGenerateAudioAsync(Guid.NewGuid(), pack.Narration, ct);
        return Results.Ok(new { narration = pack.Narration, boardLines = pack.BoardLines, boardTimings = pack.BoardTimings, audioUrl });
    }).DisableAntiforgery();

app.Run();

public sealed record VideoQuestionRequest(string? Question, double? Progress);
