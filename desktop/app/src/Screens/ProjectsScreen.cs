using System.Globalization;
using Godot;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Updates;

namespace Plano3D.App.Screens;

/// <summary>Tus planos: los mismos proyectos que ves en la web.</summary>
public partial class ProjectsScreen : Control
{
    private Main _main = null!;
    private VBoxContainer _list = null!;
    private Label _status = null!;

    public void Build(Main main)
    {
        _main = main;
        var bg = new Panel();
        bg.AddThemeStyleboxOverride("panel", new StyleBoxFlat { BgColor = Ui.Paper });
        AddChild(Ui.Fill(bg));

        var col = new VBoxContainer();
        col.AddThemeConstantOverride("separation", 18);
        var page = Ui.Fill(Ui.Pad(col, 48, 32));
        AddChild(page);

        var top = new HBoxContainer();
        var titles = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        titles.AddChild(Ui.Text($"Plano 3D · versión {AppVersion.Current}", 14, Ui.Accent));
        titles.AddChild(Ui.Text("Tus planos", 34));
        top.AddChild(titles);
        var user = _main.Api.User;
        top.AddChild(Ui.Text(user is null ? "" : user.IsDemo ? "Cuenta demo" : user.Name, 14, Ui.Muted));
        var refresh = Ui.Secondary("Actualizar");
        refresh.Pressed += () => _ = LoadAsync();
        top.AddChild(refresh);
        var logout = Ui.Secondary("Salir");
        logout.Pressed += () => _ = _main.LogoutAsync();
        top.AddChild(logout);
        col.AddChild(top);

        var update = new PanelContainer { Visible = false };
        update.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Accent, 0.12f), 10, Ui.Accent, 12));
        var updateRow = new HBoxContainer();
        updateRow.AddThemeConstantOverride("separation", 12);
        var updateText = Ui.Text("", 14, wrap: true);
        updateText.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        updateRow.AddChild(updateText);
        var get = Ui.Secondary("Descargar");
        updateRow.AddChild(get);
        update.AddChild(updateRow);
        col.AddChild(update);
        _ = ShowUpdateAsync(update, updateText, get);

        _status = Ui.Text("Cargando proyectos…", 14, Ui.Muted);
        col.AddChild(_status);

        var scroll = new ScrollContainer { SizeFlagsVertical = SizeFlags.ExpandFill, HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        _list = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _list.AddThemeConstantOverride("separation", 10);
        scroll.AddChild(_list);
        col.AddChild(scroll);
        _ = LoadAsync();
    }

    private async Task ShowUpdateAsync(Control box, Label text, Button get)
    {
        if (await _main.UpdateAsync() is not { } info || !IsInstanceValid(box)) return;
        text.Text = $"Hay una versión nueva de Plano 3D: {info.Latest.ToString(3)} (tienes {AppVersion.Current}).";
        get.Pressed += () => OS.ShellOpen(info.Url);
        box.Visible = true;
    }

    private async Task LoadAsync()
    {
        _status.Text = "Cargando proyectos…";
        _status.Visible = true;
        try
        {
            var projects = await _main.Api.ProjectsAsync();
            foreach (var child in _list.GetChildren()) child.QueueFree();
            foreach (var p in projects) _list.AddChild(Card(p));
            _status.Text = projects.Count == 0 ? "Aún no tienes proyectos: créalos en la web y aparecen aquí." : $"{projects.Count} proyecto(s). Abre uno para verlo en 3D; los cambios de la web llegan al instante.";
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or TaskCanceledException)
        {
            _status.Text = _main.Friendly(e);
        }
    }

    private Control Card(ProjectSummary p)
    {
        var card = new PanelContainer();
        var row = new HBoxContainer();
        card.AddChild(row);
        var info = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        info.AddThemeConstantOverride("separation", 4);
        info.AddChild(Ui.Text(p.Name, 19));
        var area = p.TotalArea is { } a ? $" · {a.ToString("0.#", CultureInfo.GetCultureInfo("es-CO"))} m²" : "";
        info.AddChild(Ui.Text($"{p.RoomCount} ambientes{area} · {Status(p.Status)}", 13, Ui.Muted));
        row.AddChild(info);
        var open = Ui.Primary("Abrir en 3D");
        open.Disabled = p.Status != "ready";
        open.Pressed += async () =>
        {
            var editor = _main.ShowEditor(p.Id, p.Name);
            await editor.LoadAsync();
        };
        open.SizeFlagsVertical = SizeFlags.ShrinkCenter;
        row.AddChild(open);
        return card;
    }

    private static string Status(string s) => s switch
    {
        "ready" => "listo",
        "processing" or "pending" => "analizando la foto…",
        "failed" => "falló el análisis",
        _ => s,
    };
}
