using System.Text.Json.Nodes;
using Godot;
using Plano3D.App.Plan;
using Plano3D.App.Scene;
using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Json;
using Plano3D.Core.Model;

namespace Plano3D.App.Screens;

/// <summary>Un comando de la paleta (Ctrl+K): nombre, atajo y qué hace.</summary>
public sealed record EditorCommand(string Title, string Shortcut, Action Run);

/// <summary>Barra superior, herramientas, panel de propiedades, catálogo, acabados, paleta y teclado.</summary>
public partial class EditorScreen
{
    private Label _title = null!;
    private Label _status = null!;
    private HBoxContainer _peers = null!;
    private OptionButton _levelPick = null!;
    private Label _toast = null!;
    private Label _loading = null!;
    private Label _help = null!;
    private HBoxContainer _topRow = null!;
    private Button _commandButton = null!;
    private PlanView _plan = null!;
    private Button _undoButton = null!;
    private Button _redoButton = null!;
    private readonly Dictionary<ViewMode, Button> _modeButtons = [];
    private readonly Dictionary<string, Button> _toolButtons = [];
    private Dictionary<string, PlanTool> _tools = null!;
    private PanelContainer _side = null!;
    private VBoxContainer _inspector = null!;
    private PanelContainer _palette = null!;
    private LineEdit _paletteQuery = null!;
    private ItemList _paletteList = null!;
    private List<EditorCommand> _paletteShown = [];

    private static readonly (string Key, string Name, Key Shortcut)[] ToolOrder =
    [
        ("select", "Elegir", Key.V),
        ("wall", "Muro", Key.W),
        ("door", "Puerta", Key.D),
        ("window", "Ventana", Key.N),
        ("room", "Ambiente", Key.H),
        ("column", "Columna", Key.O),
        ("furniture", "Mueble", Key.P),
        ("measure", "Medir", Key.M),
        ("paint", "Pintar", Key.B),
    ];

    private void BuildPanels(string name)
    {
        _tools = new()
        {
            ["select"] = new SelectTool(),
            ["wall"] = new WallTool(),
            ["door"] = new OpeningTool("door"),
            ["window"] = new OpeningTool("window"),
            ["room"] = new RoomTool(),
            ["column"] = new ColumnTool(),
            ["furniture"] = new FurnitureTool(),
            ["measure"] = new MeasureTool(),
            ["paint"] = new PaintTool(),
        };

        // la planta va primero: queda detrás de las barras
        _plan = new PlanView { Name = "Planta", Visible = false };
        _plan.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(_plan);
        _plan.Setup(this, _tools["select"]);

        // ---------------------------------------------------------------- barra superior
        var bar = new PanelContainer();
        bar.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.96f), 14, Ui.Line, 8));
        bar.SetAnchorsPreset(LayoutPreset.TopWide);
        bar.OffsetLeft = 16;
        bar.OffsetRight = -16;
        bar.OffsetTop = 12;
        AddChild(bar);
        var row = new HBoxContainer();
        row.AddThemeConstantOverride("separation", 8);
        bar.AddChild(row);
        var back = Ui.Flat("←  Proyectos");
        back.Pressed += () => _main.ShowProjects();
        row.AddChild(back);
        _title = Ui.Text(name, 17);
        _title.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        _title.VerticalAlignment = VerticalAlignment.Center;
        _title.ClipText = true;
        row.AddChild(_title);

        var modes = new ButtonGroup();
        foreach (var (mode, label, tip) in new[] { (ViewMode.Model3D, "3D", "Solo la casa en 3D (F2)"), (ViewMode.Plan, "Planta", "Solo la planta del piso (F3)"), (ViewMode.Split, "Ambas", "Planta y 3D lado a lado (F4)") })
        {
            var b = new Button { Text = label, ToggleMode = true, ButtonGroup = modes, TooltipText = tip, CustomMinimumSize = new Vector2(64, 0) };
            b.Pressed += () => SetMode(mode);
            row.AddChild(b);
            _modeButtons[mode] = b;
        }
        _modeButtons[ViewMode.Model3D].ButtonPressed = true;

        _undoButton = Ui.Flat("↶");
        _undoButton.Pressed += Undo;
        row.AddChild(_undoButton);
        _redoButton = Ui.Flat("↷");
        _redoButton.Pressed += Redo;
        row.AddChild(_redoButton);
        UpdateUndoButtons();

        _levelPick = new OptionButton { TooltipText = "Piso activo (RePág / AvPág)" };
        _levelPick.ItemSelected += i => SetLevel((int)i);
        row.AddChild(_levelPick);
        var upper = new CheckButton { Text = "Pisos de arriba", ButtonPressed = true, TooltipText = "Mostrar en 3D los pisos que están encima del activo" };
        upper.Toggled += on =>
        {
            _showUpper = on;
            ApplyLevelFilter();
        };
        row.AddChild(upper);
        var frame = Ui.Flat("Encuadrar");
        frame.TooltipText = "Encuadrar la casa (F)";
        frame.Pressed += () => FrameHouse(false);
        row.AddChild(frame);
        var cmd = Ui.Flat("⌘ Comandos");
        cmd.TooltipText = "Buscar cualquier acción (Ctrl+K)";
        cmd.Pressed += OpenPalette;
        row.AddChild(cmd);
        _topRow = row;
        _commandButton = cmd;
        _peers = new HBoxContainer();
        _peers.AddThemeConstantOverride("separation", 6);
        row.AddChild(_peers);
        _status = Ui.Text("conectando…", 13, Ui.Muted);
        _status.VerticalAlignment = VerticalAlignment.Center;
        row.AddChild(_status);

        // ---------------------------------------------------------------- herramientas
        var rail = new PanelContainer();
        rail.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.96f), 14, Ui.Line, 6));
        rail.Position = new Vector2(16, 84);
        AddChild(rail);
        var tools = new VBoxContainer();
        tools.AddThemeConstantOverride("separation", 2);
        rail.AddChild(tools);
        var group = new ButtonGroup();
        foreach (var (key, toolName, shortcut) in ToolOrder)
        {
            var b = new Button
            {
                Text = toolName,
                ToggleMode = true,
                ButtonGroup = group,
                Alignment = HorizontalAlignment.Left,
                TooltipText = $"{toolName} ({shortcut})",
                CustomMinimumSize = new Vector2(124, 34),
                ThemeTypeVariation = "FlatButton",
            };
            b.Pressed += () => SetTool(key);
            var hint = Ui.Text(shortcut.ToString(), 11, Ui.Muted);
            hint.SetAnchorsPreset(LayoutPreset.CenterRight);
            hint.OffsetLeft = -22;
            hint.GrowHorizontal = GrowDirection.Begin;
            b.AddChild(hint);
            tools.AddChild(b);
            _toolButtons[key] = b;
        }
        _toolButtons["select"].ButtonPressed = true;

        // ---------------------------------------------------------------- panel derecho
        _side = new PanelContainer { CustomMinimumSize = new Vector2(300, 0) };
        _side.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Surface, 0.97f), 14, Ui.Line, 14));
        _side.AnchorLeft = 1;
        _side.AnchorRight = 1;
        _side.AnchorTop = 0;
        _side.AnchorBottom = 1;
        _side.OffsetLeft = -316;
        _side.OffsetRight = -16;
        _side.OffsetTop = 84;
        _side.OffsetBottom = -56;
        AddChild(_side);
        var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        _side.AddChild(scroll);
        _inspector = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _inspector.AddThemeConstantOverride("separation", 8);
        scroll.AddChild(_inspector);

        // ---------------------------------------------------------------- avisos y ayuda
        _toast = Ui.Text("", 14, Ui.Paper);
        var toastBox = new PanelContainer { Visible = false, Name = "Aviso" };
        toastBox.AddThemeStyleboxOverride("panel", Ui.Box(new Color(Ui.Ink, 0.88f), 999, null, 10));
        toastBox.AddChild(_toast);
        toastBox.SetAnchorsPreset(LayoutPreset.CenterBottom);
        toastBox.GrowHorizontal = GrowDirection.Both;
        toastBox.GrowVertical = GrowDirection.Begin;
        toastBox.OffsetBottom = -28;
        AddChild(toastBox);

        _help = Ui.Text("", 12, Ui.Muted);
        _help.SetAnchorsPreset(LayoutPreset.BottomRight);
        _help.GrowHorizontal = GrowDirection.Begin;
        _help.GrowVertical = GrowDirection.Begin;
        _help.OffsetRight = -16;
        _help.OffsetBottom = -16;
        AddChild(_help);
        UpdateHelp();

        _loading = Ui.Text("Abriendo el proyecto…", 18, Ui.Muted);
        _loading.SetAnchorsPreset(LayoutPreset.Center);
        _loading.GrowHorizontal = GrowDirection.Both;
        _loading.GrowVertical = GrowDirection.Both;
        AddChild(_loading);

        BuildPalette();
        RefreshInspector();
    }

    // ------------------------------------------------------------------ modo de vista y herramienta
    public void SetMode(ViewMode mode)
    {
        _mode = mode;
        _modeButtons[mode].ButtonPressed = true;
        _plan.Visible = mode != ViewMode.Model3D;
        _plan.AnchorRight = mode == ViewMode.Split ? 0.5f : 1;
        _plan.OffsetRight = 0;
        if (_plan.Visible) Callable.From(_plan.Fit).CallDeferred();
        UpdateHelp();
    }

    public void SetTool(string key)
    {
        if (!_tools.TryGetValue(key, out var tool)) return;
        _plan.SetTool(tool);
        _toolButtons[key].ButtonPressed = true;
        // dibujar muros, aberturas, ambientes y medir se hace sobre la planta
        if (_mode == ViewMode.Model3D && key is "wall" or "door" or "window" or "room" or "measure") SetMode(ViewMode.Split);
        RefreshInspector(force: true);
        UpdateHelp();
        SendPresence();
    }

    private void UpdateHelp()
    {
        if (_help is null || _plan is null) return;
        _help.Text = _mode == ViewMode.Plan
            ? "Rueda acerca · clic derecho desplaza · Ctrl+Z deshace · Ctrl+K comandos"
            : "Arrastra para girar · clic derecho para mover · rueda acerca · Ctrl+K comandos";
    }

    private void UpdateUndoButtons()
    {
        _undoButton.Disabled = !_history.CanUndo;
        _undoButton.TooltipText = _history.UndoLabel is { } u ? $"Deshacer: {u} (Ctrl+Z)" : "Deshacer (Ctrl+Z)";
        _redoButton.Disabled = !_history.CanRedo;
        _redoButton.TooltipText = _history.RedoLabel is { } r ? $"Rehacer: {r} (Ctrl+Y)" : "Rehacer (Ctrl+Y)";
    }

    // ------------------------------------------------------------------ panel de propiedades
    private void RefreshInspector(bool force = false)
    {
        if (_inspector is null) return;
        // no se rehace mientras se escribe en uno de sus campos
        if (!force && GetViewport()?.GuiGetFocusOwner() is { } focus && _side.IsAncestorOf(focus)) return;
        foreach (var c in _inspector.GetChildren())
        {
            _inspector.RemoveChild(c);
            c.QueueFree();
        }
        if (_model is null) return;
        if (_plan.Tool is FurnitureTool) CatalogPanel();
        else if (_plan.Tool is PaintTool) FinishesPanel();
        else if (_selection.Count == 0) LevelPanel();
        else if (_selection.Count > 1) GroupPanel();
        else if (ModelEditor.Find(_model, _selection[0]) is { } f) EntityPanel(f);
    }

    private void Header(string title, string? subtitle = null)
    {
        _inspector.AddChild(Ui.Text(title, 18));
        if (subtitle is not null) _inspector.AddChild(Ui.Text(subtitle, 12, Ui.Muted, wrap: true));
    }

    private void Row(string label, Control control)
    {
        var h = new HBoxContainer();
        var l = Ui.Text(label, 13, Ui.Muted);
        l.CustomMinimumSize = new Vector2(92, 0);
        l.VerticalAlignment = VerticalAlignment.Center;
        h.AddChild(l);
        control.SizeFlagsHorizontal = SizeFlags.ExpandFill;
        h.AddChild(control);
        _inspector.AddChild(h);
    }

    private static SpinBox Number(double value, double min, double max, double step, string suffix, Action<double> commit)
    {
        var sb = new SpinBox { MinValue = min, MaxValue = max, Step = step, Value = value, Suffix = suffix, SelectAllOnFocus = true, CustomArrowStep = step };
        sb.ValueChanged += v => commit(v);
        return sb;
    }

    private static OptionButton Choice(IEnumerable<(string Id, string Name)> options, string? current, Action<string> commit)
    {
        var ob = new OptionButton();
        var list = options.ToList();
        for (var i = 0; i < list.Count; i++)
        {
            ob.AddItem(list[i].Name, i);
            if (list[i].Id == current) ob.Select(i);
        }
        if (list.All(o => o.Id != current)) ob.Select(-1);
        ob.ItemSelected += i => commit(list[(int)i].Id);
        return ob;
    }

    private static LineEdit TextField(string value, Action<string> commit)
    {
        var le = new LineEdit { Text = value, SelectAllOnFocus = true };
        void Done()
        {
            if (le.Text.Trim() != value && le.Text.Trim().Length > 0) commit(le.Text.Trim());
        }
        le.TextSubmitted += _ => Done();
        le.FocusExited += Done;
        return le;
    }

    private void Buttons(params (string Text, Action Run)[] buttons)
    {
        var flow = new HFlowContainer();
        flow.AddThemeConstantOverride("h_separation", 6);
        flow.AddThemeConstantOverride("v_separation", 6);
        foreach (var (text, run) in buttons)
        {
            var b = Ui.Secondary(text);
            b.CustomMinimumSize = new Vector2(0, 34);
            b.Pressed += run;
            flow.AddChild(b);
        }
        _inspector.AddChild(flow);
    }

    private void Set(string id, string field, JsonNode? value, string label) =>
        Edit(label, m => ModelEditor.Patch(m, id, field, value), _selection);

    private static string LevelName(Found f) => f.Level.Str("name") ?? "";

    private void EntityPanel(Found f)
    {
        var e = f.Entity;
        var id = e.Str("id")!;
        double N(string k, double d = 0) => ModelEditor.Num(e, k, d);
        switch (f.Kind)
        {
            case "wall":
                var wall = BuildingModel.ParseWall(e);
                Header("Muro", $"{LevelName(f)} · {wall.OpeningsOrEmpty.Count} abertura(s)");
                Row("Largo", Number(wall.Length, ModelEditor.MinWall, 200, 0.01, " m", v => Set(id, "length", v, "Largo del muro")));
                Row("Grosor", Number(wall.Thickness, 0.05, 1, 0.01, " m", v => Set(id, "thickness", v, "Grosor del muro")));
                Row("Alto", Number(wall.Height, 0.3, 12, 0.05, " m", v => Set(id, "height", v, "Alto del muro")));
                Row("Acabado", Choice(Catalog.WallFinishes.Select(m => (m.Id, m.Name)), Catalog.WallFinish(wall.Material)?.Id, v => Set(id, "material", v, "Acabado del muro")));
                Buttons(("Duplicar", DuplicateSelection), ("Borrar", DeleteSelection));
                break;
            case "opening":
                OpeningPanel(f, id);
                break;
            case "furniture":
                var item = Catalog.Item(e.Str("catalog_id") ?? "");
                Header(item?.Name ?? "Mueble", LevelName(f));
                Row("Pieza", Choice(Catalog.Items.Select(i => (i.Id, $"{i.Category} · {i.Name}")), item?.Id, v => Edit("Cambiar pieza", m =>
                {
                    var it = Catalog.Item(v)!;
                    m = ModelEditor.Patch(m, id, "catalog_id", v);
                    m = ModelEditor.Patch(m, id, "width", it.Width);
                    m = ModelEditor.Patch(m, id, "depth", it.Depth);
                    return ModelEditor.Patch(m, id, "height", it.Height);
                }, _selection)));
                var pos = ModelEditor.Pt(e["position"]);
                Row("X", Number(pos.X, -500, 500, 0.01, " m", v => Set(id, "x", v, "Mover")));
                Row("Y", Number(pos.Y, -500, 500, 0.01, " m", v => Set(id, "y", v, "Mover")));
                Row("Giro", Number(Math.Round(N("rotation") * 180 / Math.PI), -360, 360, 1, "°", v => Set(id, "rotation", v * Math.PI / 180, "Girar")));
                Row("Ancho", Number(N("width"), 0.05, 10, 0.01, " m", v => Set(id, "width", v, "Ancho del mueble")));
                Row("Fondo", Number(N("depth"), 0.05, 10, 0.01, " m", v => Set(id, "depth", v, "Fondo del mueble")));
                Row("Alto", Number(N("height"), 0.01, 4, 0.01, " m", v => Set(id, "height", v, "Alto del mueble")));
                Buttons(("Girar 90°", () => RotateSelection(Math.PI / 2)), ("Reflejar", () => Edit("Reflejar", m => ModelEditor.Mirror(m, _selection), _selection)),
                    ("Duplicar", DuplicateSelection), ("Borrar", DeleteSelection));
                break;
            case "column":
                Header("Columna", LevelName(f));
                var c = ModelEditor.Pt(e["center"]);
                Row("X", Number(c.X, -500, 500, 0.01, " m", v => Set(id, "x", v, "Mover")));
                Row("Y", Number(c.Y, -500, 500, 0.01, " m", v => Set(id, "y", v, "Mover")));
                Row("Ancho", Number(N("width", 0.3), 0.1, 3, 0.01, " m", v => Set(id, "width", v, "Ancho de columna")));
                Row("Fondo", Number(N("depth", 0.3), 0.1, 3, 0.01, " m", v => Set(id, "depth", v, "Fondo de columna")));
                Row("Giro", Number(Math.Round(N("rotation") * 180 / Math.PI), -360, 360, 1, "°", v => Set(id, "rotation", v * Math.PI / 180, "Girar")));
                Buttons(("Duplicar", DuplicateSelection), ("Borrar", DeleteSelection));
                break;
            case "room":
                var room = BuildingModel.ParseRoom(e);
                Header(string.IsNullOrWhiteSpace(room.Label) ? "Ambiente" : room.Label, $"{LevelName(f)} · {Math.Abs(BuildingGeometry.SignedArea(room.Polygon)):0.0} m²");
                Row("Nombre", TextField(room.Label, v => Set(id, "label", v, "Nombre del ambiente")));
                Row("Piso", Choice(Catalog.FloorFinishes.Select(m => (m.Id, m.Name)), room.FloorMaterial, v => Set(id, "floor_material", v, "Piso del ambiente")));
                Buttons(("Duplicar", DuplicateSelection), ("Borrar", DeleteSelection));
                break;
            case "stair":
                Header("Escalera", LevelName(f));
                Row("Ancho", Number(N("width", 1), 0.6, 3, 0.01, " m", v => Set(id, "width", v, "Ancho de escalera")));
                Row("Peldaños", Number(N("steps", 16), 2, 40, 1, "", v => Set(id, "steps", (int)v, "Peldaños")));
                Buttons(("Borrar", DeleteSelection));
                break;
            default:
                Header(f.Kind, LevelName(f));
                Buttons(("Borrar", DeleteSelection));
                break;
        }
    }

    private void OpeningPanel(Found f, string id)
    {
        var e = f.Entity;
        var isWindow = e.Str("kind") == "window";
        Header(isWindow ? "Ventana" : "Puerta", LevelName(f));
        Row("Tipo", Choice([("door", "Puerta"), ("window", "Ventana")], e.Str("kind"), v => Edit("Tipo de abertura", m =>
        {
            var spec = v == "window" ? ModelEditor.Window : ModelEditor.Door;
            m = ModelEditor.Patch(m, id, "kind", v);
            m = ModelEditor.Patch(m, id, "height", spec.Height);
            return ModelEditor.Patch(m, id, "sill", spec.Sill);
        }, _selection)));
        Row("Ancho", Number(ModelEditor.Num(e, "width"), 0.3, 6, 0.05, " m", v => Set(id, "width", v, "Ancho de la abertura")));
        Row("Alto", Number(ModelEditor.Num(e, "height"), 0.3, 4, 0.05, " m", v => Set(id, "height", v, "Alto de la abertura")));
        if (isWindow) Row("Antepecho", Number(ModelEditor.Num(e, "sill"), 0, 3, 0.05, " m", v => Set(id, "sill", v, "Antepecho")));
        _inspector.AddChild(new HSeparator());
        _inspector.AddChild(Ui.Text("Repetir a lo largo del muro", 13, Ui.Muted));
        var count = Number(3, 2, 30, 1, " en total", _ => { });
        var gap = Number(0.3, 0, 5, 0.05, " m entre", _ => { });
        Row("Cuántas", count);
        Row("Separación", gap);
        Buttons(("Repetir", () =>
        {
            if (_model is null) return;
            try
            {
                var (m, ids) = ModelEditor.ArrayOpening(_model, id, (int)count.Value, gap.Value);
                Commit(m, $"Repetir {(isWindow ? "ventana" : "puerta")}", ids.Prepend(id));
            }
            catch (EditException ex)
            {
                Toast(ex.Message);
            }
        }), ("Borrar", DeleteSelection));
    }

    private void GroupPanel()
    {
        Header($"{_selection.Count} elementos", "Mayús+clic suma o quita · arrastra para moverlos juntos");
        Buttons(("Girar 90°", () => RotateSelection(Math.PI / 2)),
            ("Reflejar ↔", () => Edit("Reflejar", m => ModelEditor.Mirror(m, _selection, true), _selection)),
            ("Reflejar ↕", () => Edit("Reflejar", m => ModelEditor.Mirror(m, _selection, false), _selection)),
            ("Duplicar", DuplicateSelection), ("Borrar", DeleteSelection));
    }

    private void LevelPanel()
    {
        if (_building?.FindLevel(_levelId ?? "") is not { } lv) return;
        var area = lv.Rooms.Sum(r => Math.Abs(BuildingGeometry.SignedArea(r.Polygon)));
        Header(lv.Name, $"{lv.Walls.Count} muros · {lv.Rooms.Count} ambientes · {lv.Furniture.Count} muebles · {area:0} m²");
        Row("Nombre", TextField(lv.Name, v => Set(lv.Id, "name", v, "Nombre del piso")));
        Row("Altura", Number(BuildingGeometry.StoreyHeight(_building, lv), 1.8, 8, 0.05, " m", v => Set(lv.Id, "height", v, "Altura del piso")));
        Buttons(("Duplicar piso", DuplicateLevel), ("Borrar piso", DeleteLevel));
        _inspector.AddChild(new HSeparator());
        _inspector.AddChild(Ui.Text(
            "Elige algo con un clic (en la planta o en el 3D) para ver sus medidas.\n\n" +
            "V elegir · W muro · D puerta · N ventana · H ambiente · O columna · P mueble · M medir · B pintar\n\n" +
            "Ctrl+Z deshacer · Ctrl+D duplicar · Supr borrar · R girar · flechas mueven · G imán · Ctrl+1…4 guarda una vista y 1…4 vuelve a ella",
            12, Ui.Muted, wrap: true));
    }

    private void DuplicateLevel()
    {
        if (_model is null || _levelId is null) return;
        try
        {
            var (m, id) = ModelEditor.DuplicateLevel(_model, _levelId);
            _levelId = id;
            Commit(m, "Duplicar piso", []);
            _plan.Fit();
            RefreshInspector(force: true);
        }
        catch (EditException e)
        {
            Toast(e.Message);
        }
    }

    private void DeleteLevel()
    {
        if (_levelId is null) return;
        var id = _levelId;
        Edit("Borrar piso", m => ModelEditor.DeleteLevel(m, id), []);
    }

    private void CatalogPanel()
    {
        Header("Muebles", "Elige una pieza y haz clic en la planta o en el 3D · R la gira");
        var search = new LineEdit { PlaceholderText = "Buscar (cama, baño, sofá…)", ClearButtonEnabled = true };
        _inspector.AddChild(search);
        var list = new ItemList { CustomMinimumSize = new Vector2(0, 420), SizeFlagsVertical = SizeFlags.ExpandFill };
        _inspector.AddChild(list);
        void Fill(string q)
        {
            list.Clear();
            foreach (var it in Catalog.Search(q))
            {
                var i = list.AddItem($"{it.Name}   ·   {it.Width:0.00} × {it.Depth:0.00} m");
                list.SetItemMetadata(i, it.Id);
                list.SetItemTooltip(i, it.Category);
                if (it.Id == _catalogId) list.Select(i);
            }
        }
        Fill("");
        search.TextChanged += Fill;
        list.ItemSelected += i =>
        {
            _catalogId = list.GetItemMetadata((int)i).AsString();
            _plan.QueueRedraw();
        };
    }

    private void FinishesPanel()
    {
        Header("Pintar", "Elige un acabado y haz clic en un muro o en un ambiente (planta o 3D)");
        void Swatches(string title, IReadOnlyList<FinishSpec> specs, string current, Action<string> pick)
        {
            _inspector.AddChild(Ui.Text(title, 13, Ui.Muted));
            var grid = new GridContainer { Columns = 2 };
            grid.AddThemeConstantOverride("h_separation", 6);
            grid.AddThemeConstantOverride("v_separation", 6);
            var group = new ButtonGroup();
            foreach (var s in specs)
            {
                var color = new Color(s.Color);
                var b = new Button { Text = s.Name, ToggleMode = true, ButtonGroup = group, CustomMinimumSize = new Vector2(130, 44), ButtonPressed = s.Id == current };
                var dark = color.Luminance < 0.5f;
                foreach (var state in new[] { "normal", "hover", "pressed", "focus" })
                    b.AddThemeStyleboxOverride(state, Ui.Box(color, 8, state == "pressed" ? Ui.Accent : Ui.Line, 6));
                foreach (var fc in new[] { "font_color", "font_hover_color", "font_pressed_color", "font_focus_color" })
                    b.AddThemeColorOverride(fc, dark ? Ui.Paper : Ui.Ink);
                b.Pressed += () => pick(s.Id);
                grid.AddChild(b);
            }
            _inspector.AddChild(grid);
        }
        Swatches("Muros", Catalog.WallFinishes, _wallFinish, id => _wallFinish = id);
        Swatches("Pisos", Catalog.FloorFinishes, _floorFinish, id => _floorFinish = id);
    }

    // ------------------------------------------------------------------ paleta de comandos
    private void BuildPalette()
    {
        _palette = new PanelContainer { Visible = false, CustomMinimumSize = new Vector2(540, 0) };
        _palette.AddThemeStyleboxOverride("panel", Ui.Box(Ui.Surface, 16, Ui.Line, 14));
        _palette.SetAnchorsPreset(LayoutPreset.CenterTop);
        _palette.GrowHorizontal = GrowDirection.Both;
        _palette.OffsetTop = 110;
        AddChild(_palette);
        var box = new VBoxContainer();
        _palette.AddChild(box);
        _paletteQuery = new LineEdit { PlaceholderText = "¿Qué quieres hacer? (muro, deshacer, duplicar piso…)" };
        box.AddChild(_paletteQuery);
        _paletteList = new ItemList { CustomMinimumSize = new Vector2(0, 340) };
        box.AddChild(_paletteList);
        _paletteQuery.TextChanged += FilterPalette;
        _paletteQuery.TextSubmitted += _ => RunPalette(_paletteList.GetSelectedItems() is { Length: > 0 } s ? s[0] : 0);
        _paletteList.ItemActivated += i => RunPalette((int)i);
        _paletteQuery.GuiInput += e =>
        {
            if (e is not InputEventKey { Pressed: true } k) return;
            if (k.Keycode == Key.Escape) ClosePalette();
            else if (k.Keycode == Key.Down && _paletteList.ItemCount > 0)
            {
                _paletteList.GrabFocus();
                _paletteList.Select(0);
            }
        };
    }

    public List<EditorCommand> Commands()
    {
        var list = ToolOrder.Select(t => new EditorCommand($"Herramienta: {t.Name}", t.Shortcut.ToString(), () => SetTool(t.Key))).ToList();
        list.AddRange(
        [
            new("Vista 3D", "F2", () => SetMode(ViewMode.Model3D)),
            new("Vista de planta", "F3", () => SetMode(ViewMode.Plan)),
            new("Planta y 3D lado a lado", "F4", () => SetMode(ViewMode.Split)),
            new("Deshacer", "Ctrl+Z", Undo),
            new("Rehacer", "Ctrl+Y", Redo),
            new("Duplicar lo elegido", "Ctrl+D", DuplicateSelection),
            new("Borrar lo elegido", "Supr", DeleteSelection),
            new("Girar lo elegido 90°", "R", () => RotateSelection(Math.PI / 2)),
            new("Reflejar lo elegido (izquierda ↔ derecha)", "", () => Edit("Reflejar", m => ModelEditor.Mirror(m, _selection, true), _selection)),
            new("Reflejar lo elegido (arriba ↕ abajo)", "", () => Edit("Reflejar", m => ModelEditor.Mirror(m, _selection, false), _selection)),
            new("Elegir todo el piso", "Ctrl+A", SelectAll),
            new("Duplicar este piso encima", "", DuplicateLevel),
            new("Borrar este piso", "", DeleteLevel),
            new("Piso de arriba", "RePág", () => SetLevel(_levelPick.Selected + 1)),
            new("Piso de abajo", "AvPág", () => SetLevel(_levelPick.Selected - 1)),
            new("Encuadrar la casa", "F", () => FrameHouse(false)),
            new("Imán a la rejilla (5 cm): activar o quitar", "G", ToggleGrid),
            new("Modo foto", "", () => SetPhotoMode(true)),
            new("Capturar la vista en 4K", "F12", () => _ = CaptureAsync(0)),
            new("Luz, hora y calidad", "L", ToggleLightPanel),
            new("Hora: mañana (8:00)", "", () => SetHour(8)),
            new("Hora: mediodía", "", () => SetHour(12)),
            new("Hora: atardecer", "", () => SetHour(17.0)),
            new("Hora: noche (luces encendidas)", "", () => SetHour(20.5)),
            new("Volver a los proyectos", "", () => _main.ShowProjects()),
        ]);
        foreach (var q in Enum.GetValues<Quality>()) list.Add(new($"Calidad gráfica: {Atmosphere.Label(q)}", "", () => SetQuality(q)));
        for (var i = 1; i <= 4; i++)
        {
            var n = i;
            list.Add(new($"Guardar la vista {n}", $"Ctrl+{n}", () => SaveBookmark(n)));
            list.Add(new($"Ir a la vista {n}", $"{n}", () => GoBookmark(n)));
        }
        return list;
    }

    private void OpenPalette()
    {
        _palette.Visible = true;
        _paletteQuery.Text = "";
        FilterPalette("");
        _paletteQuery.GrabFocus();
    }

    private void ClosePalette()
    {
        _palette.Visible = false;
        _plan.GrabFocus();
    }

    private void FilterPalette(string q)
    {
        var norm = Catalog.Normalize(q);
        _paletteShown = Commands().Where(c => norm.Length == 0 || Catalog.Normalize(c.Title).Contains(norm)).ToList();
        _paletteList.Clear();
        foreach (var c in _paletteShown) _paletteList.AddItem(c.Shortcut.Length > 0 ? $"{c.Title}      {c.Shortcut}" : c.Title);
        if (_paletteShown.Count > 0) _paletteList.Select(0);
    }

    private void RunPalette(int index)
    {
        if (index < 0 || index >= _paletteShown.Count) return;
        var cmd = _paletteShown[index];
        ClosePalette();
        cmd.Run();
    }

    // ------------------------------------------------------------------ teclado
    private void ToggleGrid()
    {
        _gridSnap = !_gridSnap;
        Toast(_gridSnap ? "Imán a la rejilla de 5 cm" : "Sin imán a la rejilla");
    }

    private void SaveBookmark(int n)
    {
        _bookmarks[n] = _camera.Bookmark;
        Toast($"Vista {n} guardada (tecla {n} para volver)");
    }

    private void GoBookmark(int n)
    {
        if (_bookmarks.TryGetValue(n, out var v)) _camera.GoTo(v);
        else Toast($"Ctrl+{n} guarda la vista actual en el {n}");
    }

    public override void _UnhandledKeyInput(InputEvent e)
    {
        if (e is not InputEventKey { Pressed: true } k || _model is null) return;
        if (_palette.Visible)
        {
            if (k.Keycode == Key.Escape) ClosePalette();
            return;
        }
        if (PhotoMode)
        {
            if (k.Keycode == Key.Escape) SetPhotoMode(false);
            else if (k.Keycode == Key.F12) _ = CaptureAsync(0);
            else if (k.Keycode == Key.F) FrameHouse(false);
            GetViewport().SetInputAsHandled();
            return;
        }
        if (_plan.Tool.OnKey(k))
        {
            _plan.QueueRedraw();
            GetViewport().SetInputAsHandled();
            return;
        }
        var handled = true;
        var step = k.ShiftPressed ? 0.5 : 0.05;
        switch (k.Keycode)
        {
            case Key.Z when k.CtrlPressed && k.ShiftPressed:
            case Key.Y when k.CtrlPressed:
                Redo();
                break;
            case Key.Z when k.CtrlPressed:
                Undo();
                break;
            case Key.D when k.CtrlPressed:
                DuplicateSelection();
                break;
            case Key.K when k.CtrlPressed:
                OpenPalette();
                break;
            case Key.A when k.CtrlPressed:
                SelectAll();
                break;
            case var digit when digit >= Key.Key1 && digit <= Key.Key4:
                var n = (int)(k.Keycode - Key.Key1) + 1;
                if (k.CtrlPressed) SaveBookmark(n);
                else GoBookmark(n);
                break;
            case Key.Delete or Key.Backspace:
                DeleteSelection();
                break;
            case Key.Escape:
                if (_plan.Tool is not SelectTool) SetTool("select");
                else Select([]);
                break;
            case Key.F:
                FrameHouse(false);
                break;
            case Key.L when !k.CtrlPressed:
                ToggleLightPanel();
                break;
            case Key.F12:
                _ = CaptureAsync(0);
                break;
            case Key.G:
                ToggleGrid();
                break;
            case Key.R when _selection.Count > 0:
                RotateSelection(k.ShiftPressed ? Math.PI / 12 : Math.PI / 2);
                break;
            case Key.Pageup:
                SetLevel(_levelPick.Selected + 1);
                break;
            case Key.Pagedown:
                SetLevel(_levelPick.Selected - 1);
                break;
            case Key.F2:
                SetMode(ViewMode.Model3D);
                break;
            case Key.F3:
                SetMode(ViewMode.Plan);
                break;
            case Key.F4:
                SetMode(ViewMode.Split);
                break;
            case Key.Left when _selection.Count > 0:
                Nudge(new Point2(-step, 0));
                break;
            case Key.Right when _selection.Count > 0:
                Nudge(new Point2(step, 0));
                break;
            case Key.Up when _selection.Count > 0:
                Nudge(new Point2(0, -step));
                break;
            case Key.Down when _selection.Count > 0:
                Nudge(new Point2(0, step));
                break;
            default:
                var tool = ToolOrder.FirstOrDefault(t => t.Shortcut == k.Keycode && !k.CtrlPressed && !k.AltPressed);
                if (tool.Key is not null) SetTool(tool.Key);
                else handled = false;
                break;
        }
        if (handled) GetViewport().SetInputAsHandled();
    }
}
