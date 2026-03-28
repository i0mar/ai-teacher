using AiTeacher.Services.Ai;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace AiTeacher.Pages.Realtime;

public class IndexModel : PageModel
{
    private readonly OpenAiRealtimeClient _realtime;

    public IndexModel(OpenAiRealtimeClient realtime)
    {
        _realtime = realtime;
    }

    public IReadOnlyList<string> SuggestedTopics { get; } =
    [
        "Solving systems of equations with substitution",
        "Hard SAT transition words in context",
        "Reading graphs and tables quickly",
        "Percent change word problems",
        "Quadratics and factoring patterns",
        "Inference questions in reading passages",
        "Subject-verb agreement traps",
        "Triangles and similar figures"
    ];

    public bool IsRealtimeAvailable { get; private set; }

    public string AvailabilityMessage { get; private set; } = "";

    public void OnGet()
    {
        IsRealtimeAvailable = _realtime.IsConfigured();
        AvailabilityMessage = IsRealtimeAvailable
            ? "Mic interruptions are enabled. Speak naturally or type whenever you want to jump in."
            : "Live mode requires a valid Ai__OpenAi__ApiKey.";
    }
}
