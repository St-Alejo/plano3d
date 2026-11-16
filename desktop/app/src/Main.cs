using System.Collections.Concurrent;
using Godot;
using Plano3D.App.Screens;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Updates;

namespace Plano3D.App;

/// <summary>
/// Raíz de la app: arma la sesión, cambia de pantalla (entrar → proyectos → editor) y pasa al
/// hilo principal lo que llega de la red (Godot solo deja tocar nodos desde ese hilo).
/// </summary>
public partial class Main : Node
{
    private static readonly ConcurrentQueue<Action> Inbox = new();

    private CanvasLayer _ui = null!;
    private Control? _screen;
    private Node3D _world = null!;

    public ApiClient Api { get; private set; } = null!;
    public AppSettings Settings { get; private set; } = null!;
    private Task<UpdateInfo?>? _update;

    /// <summary>¿Hay versión nueva? Se pregunta una vez por sesión (nunca en la prueba de humo).</summary>
    public Task<UpdateInfo?> UpdateAsync() => _update ??= Launch.Smoke is not null
        ? Task.FromResult<UpdateInfo?>(null)
        : new UpdateChecker(new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(8) }).CheckAsync(Version.Parse(AppVersion.Current));
    public LaunchOptions Launch { get; private set; } = null!;
    public Theme Theme { get; } = Ui.MakeTheme();

    /// <summary>Encola trabajo para el hilo principal (seguro desde cualquier hilo).</summary>
    public static void Post(Action action) => Inbox.Enqueue(action);

    public override void _Ready()
    {
        Launch = LaunchOptions.Parse(OS.GetCmdlineUserArgs().Concat(OS.GetCmdlineArgs().Where(a => a.StartsWith("plano3d://", StringComparison.OrdinalIgnoreCase))));
        Settings = AppSettings.Load(Launch);
        CreateApi();
        var win = GetWindow();
        win.Title = "Plano 3D";
        win.MinSize = new Vector2I(1024, 640);
        RenderingServer.SetDefaultClearColor(Ui.Paper);

        _world = new Node3D { Name = "Mundo" };
        AddChild(_world);
        _ui = new CanvasLayer { Name = "Interfaz", Layer = 1 };
        AddChild(_ui);
        _ = StartAsync();
    }

    public void CreateApi()
    {
        Api?.Dispose();
        ITokenStore store = Launch.Smoke is null ? new DpapiTokenStore() : new MemoryTokenStore();
        Api = new ApiClient(new Uri(Settings.ApiUrl), store);
    }

    public override void _Process(double delta)
    {
        while (Inbox.TryDequeue(out var action))
        {
            try
            {
                action();
            }
            catch (Exception e)
            {
                GD.PushError($"[Plano3D] {e}");
            }
        }
    }

    private async Task StartAsync()
    {
        if (Launch.Smoke is not null)
        {
            await Smoke.RunAsync(this);
            return;
        }
        ShowBusy("Abriendo tu sesión…");
        try
        {
            if (Launch.Code is { } code)
            {
                await Api.ExchangeLinkCodeAsync(code);
            }
            else if (!await Api.ResumeAsync())
            {
                ShowLogin();
                return;
            }
            if (Launch.Project is { } pid) await OpenProjectAsync(pid);
            else ShowProjects();
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or TaskCanceledException)
        {
            ShowLogin(Friendly(e));
        }
    }

    // ------------------------------------------------------------------ pantallas
    public void ShowLogin(string? notice = null)
    {
        var s = new LoginScreen();
        s.Build(this, notice);
        Swap(s);
    }

    public void ShowProjects()
    {
        var s = new ProjectsScreen();
        s.Build(this);
        Swap(s);
    }

    public EditorScreen ShowEditor(string projectId, string name)
    {
        var s = new EditorScreen();
        s.Build(this, _world, projectId, name);
        Swap(s);
        return s;
    }

    public async Task OpenProjectAsync(string projectId)
    {
        var editor = ShowEditor(projectId, "Proyecto");
        await editor.LoadAsync();
    }

    public void ShowBusy(string message)
    {
        var center = new CenterContainer();
        var box = new VBoxContainer();
        box.AddChild(Ui.Text("Plano 3D", 30, Ui.Accent));
        box.AddChild(Ui.Text(message, 16, Ui.Muted));
        center.AddChild(box);
        Swap(center);
    }

    private void Swap(Control next)
    {
        if (_screen is EditorScreen old) old.Close();
        _screen?.QueueFree();
        next.Theme = Theme;
        Ui.Fill(next);
        _screen = next;
        _ui.AddChild(next);
    }

    public async Task LogoutAsync()
    {
        await Api.LogoutAsync();
        ShowLogin("Saliste de tu cuenta");
    }

    /// <summary>Mensaje de error para la persona (sin trazas).</summary>
    public string Friendly(Exception e) => e switch
    {
        ApiException a => a.Message,
        TaskCanceledException => "El servidor tardó demasiado en responder. Si la demo estaba dormida, intenta de nuevo en un momento.",
        HttpRequestException => $"No se pudo conectar con el servidor ({Settings.ApiUrl}).",
        _ => e.Message,
    };

    public override void _Notification(int what)
    {
        if (what == NotificationWMCloseRequest && _screen is EditorScreen editor) editor.Close();
    }
}
