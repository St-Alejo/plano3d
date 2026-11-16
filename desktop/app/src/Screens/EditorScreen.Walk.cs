using Godot;
using Plano3D.App.Scene;
using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Model;
using Plano3D.Core.Simulation;

namespace Plano3D.App.Screens;

/// <summary>
/// Recorrido en primera persona (con minimapa y grabación a mp4) y simulación de personas.
/// </summary>
public partial class EditorScreen
{
    private Walker? _walker;
    private Control _walkOverlay = null!;
    private Label _walkHint = null!;
    private MiniMap _minimap = null!;
    private People _people = null!;
    private bool _peopleOn;
    private double _peopleDirty;
    private Recorder? _recorder;
    private readonly List<Control> _hiddenForWalk = [];

    public bool Walking => _walker is not null;
    public Walker? Walker => _walker;
    public People People => _people;
    public bool Recording => _recorder is not null;

    private void BuildWalkPanels()
    {
        _people = new People { Name = "Personas" };
        _world.AddChild(_people);

        var walk = Ui.Flat("🚶 Recorrer");
        walk.TooltipText = "Caminar por la casa en primera persona (J)";
        walk.Pressed += () => StartWalk();
        _topRow.AddChild(walk);
        _topRow.MoveChild(walk, _commandButton.GetIndex());

        _walkOverlay = new Control { Name = "Recorrido", Visible = false, MouseFilter = MouseFilterEnum.Ignore };
        _walkOverlay.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(_walkOverlay);
        var cross = Ui.Text("+", 18, new Color(1, 1, 1, 0.7f));
        cross.SetAnchorsPreset(LayoutPreset.Center);
        cross.GrowHorizontal = GrowDirection.Both;
        cross.GrowVertical = GrowDirection.Both;
        _walkOverlay.AddChild(cross);
        var hintBox = new PanelContainer();
        hintBox.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Ink, 0.72f), 10, null, 10));
        hintBox.Position = new Vector2(16, 16);
        _walkOverlay.AddChild(hintBox);
        _walkHint = Ui.Text("", 13, Ui.Paper);
        hintBox.AddChild(_walkHint);
        _minimap = new MiniMap { CustomMinimumSize = new Vector2(230, 230), MouseFilter = MouseFilterEnum.Ignore };
        _minimap.SetAnchorsPreset(LayoutPreset.BottomLeft);
        _minimap.OffsetTop = -246;
        _minimap.OffsetLeft = 16;
        _minimap.OffsetRight = 246;
        _minimap.OffsetBottom = -16;
        _walkOverlay.AddChild(_minimap);
    }

    // ------------------------------------------------------------------ recorrido
    public bool StartWalk()
    {
        if (Walking || _building is not { } m || m.Levels.Count == 0) return false;
        var level = m.FindLevel(_levelId ?? "") ?? m.Levels[0];
        var spawn = SpawnPoint(level);
        if (spawn is null)
        {
            Toast("Este piso no tiene un ambiente donde pararse.");
            return false;
        }
        SetPhotoMode(false);
        SetMode(ViewMode.Model3D);
        _lightPanel.Visible = false;
        _hiddenForWalk.Clear();
        foreach (var c in GetChildren().OfType<Control>().Where(c => c != _walkOverlay && c.Visible))
        {
            _hiddenForWalk.Add(c);
            c.Visible = false;
        }
        _selection = [];
        _walker = new Walker();
        _world.AddChild(_walker);
        _walker.Camera.Attributes = _atmosphere.CameraAttributes;
        _walker.Place(new Vector3((float)spawn.Value.Point.X, (float)level.Elevation + 0.1f, (float)spawn.Value.Point.Y), spawn.Value.Yaw);
        _sync.SetLamps(true); // adentro se camina con la luz prendida
        _walker.Camera.MakeCurrent();
        ApplyLevelFilter();
        Reselect();
        _walkOverlay.Visible = true;
        _minimap.Setup(m, _walker);
        Input.MouseMode = Input.MouseModeEnum.Captured;
        UpdateWalkHint();
        return true;
    }

    public void StopWalk()
    {
        if (_walker is not { } w) return;
        if (Recording) _ = StopRecordingAsync();
        Input.MouseMode = Input.MouseModeEnum.Visible;
        _walker = null;
        w.QueueFree();
        _camera.MakeCurrent();
        _sync.SetLamps(_atmosphere.IsNight);
        _walkOverlay.Visible = false;
        foreach (var c in _hiddenForWalk.Where(IsInstanceValid)) c.Visible = true;
        _hiddenForWalk.Clear();
        ApplyLevelFilter();
        Reselect();
    }

    /// <summary>
    /// Dónde aparece: en el ambiente más grande del piso, en un punto libre de muebles, mirando
    /// hacia donde hay más espacio por delante.
    /// </summary>
    private static (Point2 Point, float Yaw)? SpawnPoint(Level level)
    {
        var room = level.Rooms.Where(r => r.Polygon.Count >= 3).MaxBy(r => Math.Abs(BuildingGeometry.SignedArea(r.Polygon)));
        if (room is null) return null;
        var grid = WalkGrid.Build(level, 0.2, 0.3);
        if (grid.NearestFree(Shapes.Centroid(room.Polygon)) is not { } p) return null;
        var best = (Yaw: 0f, Free: -1.0);
        for (var i = 0; i < 16; i++)
        {
            var a = i * Math.PI / 8;
            var d = new Point2(Math.Cos(a), Math.Sin(a));
            var free = 0.0;
            while (free < 12 && grid.IsFree(p + d * (free + 0.2))) free += 0.2;
            if (free > best.Free) best = ((float)Math.Atan2(-d.X, -d.Y), free);
        }
        return (p, best.Yaw);
    }

    private void UpdateWalkHint()
    {
        var rec = Recording ? "  ·  ● GRABANDO (F10 para terminar)" : "  ·  F10 graba video";
        _walkHint.Text = $"WASD camina · Shift corre · ratón mira · E abre/cierra la puerta · Esc sale{rec}";
    }

    private void UpdateWalk(double delta)
    {
        if (_walker is { } w)
        {
            _minimap.QueueRedraw();
            _recorder?.Capture(GetViewport());
        }
        if (_peopleOn && _peopleDirty > 0 && (_peopleDirty -= delta) <= 0) RebuildPeople();
    }

    /// <summary>Teclas del recorrido; true si las consumió.</summary>
    private bool WalkKey(InputEventKey k)
    {
        if (!Walking) return false;
        switch (k.Keycode)
        {
            case Key.Escape:
                if (Input.MouseMode == Input.MouseModeEnum.Captured && !Recording) Input.MouseMode = Input.MouseModeEnum.Visible;
                else StopWalk();
                break;
            case Key.F10:
                if (Recording) _ = StopRecordingAsync();
                else StartRecording();
                break;
            case Key.F12:
                _ = CaptureAsync(1);
                break;
            default:
                return false; // E y las demás las atiende el caminante
        }
        return true;
    }

    // ------------------------------------------------------------------ video
    public void StartRecording()
    {
        if (Recording) return;
        var dir = System.IO.Path.Combine(OS.GetUserDataDir(), "grabacion", DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        // el video sale limpio: sin ayuda, minimapa ni avisos (F10 termina)
        _walkOverlay.Visible = false;
        ((Control)_toast.GetParent()).Visible = false;
        _toastLeft = 0;
        _recorder = new Recorder(dir);
        UpdateWalkHint();
    }

    /// <summary>Termina la grabación y arma el mp4 con ffmpeg (en Videos\Plano 3D).</summary>
    public async Task<string?> StopRecordingAsync(string? output = null)
    {
        if (_recorder is not { } rec) return null;
        _recorder = null;
        if (Walking) _walkOverlay.Visible = true;
        UpdateWalkHint();
        output ??= System.IO.Path.Combine(OS.GetSystemDir(OS.SystemDir.Movies), "Plano 3D", $"recorrido-{DateTime.Now:yyyyMMdd-HHmmss}.mp4");
        Toast($"Armando el video ({rec.Frames} cuadros)…");
        var (ok, message) = await rec.FinishAsync(output);
        Toast(ok ? $"Video guardado: {output}" : message);
        return ok ? output : null;
    }

    // ------------------------------------------------------------------ personas
    public void SetPeople(bool on)
    {
        _peopleOn = on;
        if (on) RebuildPeople();
        else _people.Clear();
    }

    private void RebuildPeople()
    {
        _peopleDirty = 0;
        if (_building is not { } m) return;
        var active = m.FindLevel(_levelId ?? "");
        _people.Rebuild(m, l => _showUpper || Walking || active is null || l.Elevation <= active.Elevation + 0.01);
        if (_people.Unreachable.Count > 0)
            Toast($"Sin camino hasta: {string.Join(", ", _people.Unreachable.Take(3))}{(_people.Unreachable.Count > 3 ? "…" : "")}");
    }
}

/// <summary>Minimapa del recorrido: muros del piso donde se está y una flecha.</summary>
public partial class MiniMap : Control
{
    private BuildingModel? _model;
    private Walker? _walker;

    public void Setup(BuildingModel model, Walker walker)
    {
        _model = model;
        _walker = walker;
        QueueRedraw();
    }

    public override void _Draw()
    {
        DrawRect(new Rect2(Vector2.Zero, Size), new Color(Ui.Ink, 0.7f));
        if (_model is null || _walker is null || !IsInstanceValid(_walker)) return;
        var y = _walker.FeetY;
        var level = _model.Levels.Where(l => l.Elevation <= y + 0.6).OrderByDescending(l => l.Elevation).FirstOrDefault() ?? _model.Levels[0];
        var (min, max) = BuildingGeometry.Bounds(_model);
        var span = Math.Max(max.X - min.X, max.Y - min.Y) + 2;
        var k = (float)(Math.Min(Size.X, Size.Y) - 20) / (float)span;
        var offset = new Vector2(10, 10) + (Size - new Vector2(20, 20) - new Vector2((float)(max.X - min.X), (float)(max.Y - min.Y)) * k) / 2;
        Vector2 S(Point2 p) => offset + new Vector2((float)(p.X - min.X), (float)(p.Y - min.Y)) * k;
        foreach (var r in level.Rooms.Where(r => r.Polygon.Count >= 3))
            DrawColoredPolygon(r.Polygon.Select(S).ToArray(), new Color(1, 1, 1, 0.08f));
        foreach (var w in level.Walls) DrawColoredPolygon(Shapes.Wall(w).Select(S).ToArray(), new Color(1, 1, 1, 0.85f));
        var me = S(new Point2(_walker.GlobalPosition.X, _walker.GlobalPosition.Z));
        var fwd = new Vector2(-Mathf.Sin(_walker.Yaw), -Mathf.Cos(_walker.Yaw));
        var side = new Vector2(-fwd.Y, fwd.X);
        DrawColoredPolygon([me + fwd * 9, me - fwd * 5 + side * 5, me - fwd * 5 - side * 5], Ui.Accent);
        DrawString(ThemeDB.FallbackFont, new Vector2(10, Size.Y - 8), level.Name, HorizontalAlignment.Left, -1, 12, new Color(1, 1, 1, 0.8f));
    }
}
