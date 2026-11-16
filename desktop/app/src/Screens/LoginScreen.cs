using Godot;
using Plano3D.Infrastructure.Api;

namespace Plano3D.App.Screens;

/// <summary>Entrar: la misma cuenta de la web, la demo con un clic o el código de «Abrir en escritorio».</summary>
public partial class LoginScreen : Control
{
    private Main _main = null!;
    private LineEdit _email = null!;
    private LineEdit _password = null!;
    private LineEdit _code = null!;
    private LineEdit _server = null!;
    private Label _error = null!;
    private readonly List<Button> _buttons = [];

    public void Build(Main main, string? notice)
    {
        _main = main;
        var bg = new Panel();
        bg.AddThemeStyleboxOverride("panel", new StyleBoxFlat { BgColor = Ui.Paper });
        AddChild(Ui.Fill(bg));

        var center = Ui.Fill(new CenterContainer());
        AddChild(center);
        var card = new PanelContainer { CustomMinimumSize = new Vector2(440, 0) };
        center.AddChild(card);
        var col = new VBoxContainer();
        col.AddThemeConstantOverride("separation", 12);
        card.AddChild(Ui.Pad(col, 18, 14));

        col.AddChild(Ui.Text("Plano 3D", 14, Ui.Accent));
        col.AddChild(Ui.Text("Entra a tus planos", 30));
        col.AddChild(Ui.Text("La misma cuenta abre tus proyectos en la web y aquí. Lo que cambies se ve en las dos al instante.", 14, Ui.Muted, wrap: true));

        if (notice is not null) col.AddChild(Ui.Text(notice, 14, Ui.Muted, wrap: true));

        var demo = Ui.Primary("Entrar con la cuenta demo  →");
        demo.TooltipText = "Una casa de tres pisos con muebles y fachada, lista para recorrer";
        demo.Pressed += () => Run(() => _main.Api.DemoAsync());
        col.AddChild(demo);
        _buttons.Add(demo);

        col.AddChild(Separator("o con tu correo"));
        _email = Field("Correo", "tu@correo.com");
        col.AddChild(Labeled("Correo", _email));
        _password = Field("Contraseña", "");
        _password.Secret = true;
        col.AddChild(Labeled("Contraseña", _password));
        _password.TextSubmitted += _ => Login();
        var enter = Ui.Secondary("Entrar");
        enter.Pressed += Login;
        col.AddChild(enter);
        _buttons.Add(enter);

        col.AddChild(Separator("o con el código de la web"));
        var codeRow = new HBoxContainer();
        _code = Field("Código", "ABC123");
        _code.MaxLength = 6;
        _code.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        _code.TextSubmitted += _ => Exchange();
        codeRow.AddChild(_code);
        var useCode = Ui.Secondary("Usar código");
        useCode.Pressed += Exchange;
        codeRow.AddChild(useCode);
        _buttons.Add(useCode);
        col.AddChild(codeRow);
        col.AddChild(Ui.Text("En la web: «Abrir en escritorio» muestra un código de 6 letras que vale 2 minutos.", 12, Ui.Muted, wrap: true));

        _error = Ui.Text("", 14, Ui.Danger, wrap: true);
        _error.Visible = false;
        col.AddChild(_error);

        var adv = new HBoxContainer();
        adv.AddChild(Ui.Text("Servidor", 12, Ui.Muted));
        _server = new LineEdit { Text = _main.Settings.ApiUrl, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _server.AddThemeFontSizeOverride("font_size", 12);
        _server.TextSubmitted += _ => ApplyServer();
        _server.FocusExited += ApplyServer;
        adv.AddChild(_server);
        col.AddChild(adv);
    }

    private static LineEdit Field(string name, string placeholder) =>
        new() { PlaceholderText = placeholder, CustomMinimumSize = new Vector2(0, 40), TooltipText = name };

    private static VBoxContainer Labeled(string label, Control field)
    {
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 4);
        box.AddChild(Ui.Text(label, 13, Ui.Muted));
        box.AddChild(field);
        return box;
    }

    private static Control Separator(string text)
    {
        var l = Ui.Text(text.ToUpperInvariant(), 11, Ui.Muted);
        l.HorizontalAlignment = HorizontalAlignment.Center;
        return l;
    }

    private void ApplyServer()
    {
        var url = _server.Text.Trim().TrimEnd('/');
        if (url == _main.Settings.ApiUrl || !Uri.TryCreate(url, UriKind.Absolute, out _)) return;
        _main.Settings.ApiUrl = url;
        _main.Settings.Save();
        _main.CreateApi();
    }

    private void Login()
    {
        if (string.IsNullOrWhiteSpace(_email.Text) || string.IsNullOrEmpty(_password.Text))
        {
            ShowError("Escribe tu correo y tu contraseña");
            return;
        }
        Run(() => _main.Api.LoginAsync(_email.Text.Trim(), _password.Text));
    }

    private void Exchange()
    {
        if (_code.Text.Trim().Length != 6)
        {
            ShowError("El código tiene 6 caracteres");
            return;
        }
        Run(() => _main.Api.ExchangeLinkCodeAsync(_code.Text));
    }

    private async void Run(Func<Task<Session>> enter)
    {
        ApplyServer();
        SetBusy(true);
        try
        {
            await enter();
            if (_main.Launch.Project is { } pid) await _main.OpenProjectAsync(pid);
            else _main.ShowProjects();
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or TaskCanceledException)
        {
            ShowError(_main.Friendly(e));
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        foreach (var b in _buttons) b.Disabled = busy;
        if (busy) _error.Visible = false;
    }

    private void ShowError(string message)
    {
        _error.Text = message;
        _error.Visible = true;
    }
}
