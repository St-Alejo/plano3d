using System.Globalization;
using System.Text.Json.Nodes;
using Godot;
using Plano3D.App.Plan;
using Plano3D.App.Scene;
using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Json;
using Plano3D.Core.Model;
using Plano3D.Infrastructure.Api;
using Plano3D.Infrastructure.Collab;

namespace Plano3D.App.Screens;

/// <summary>
/// El editor del escritorio: la casa en 3D, la planta del piso activo, o ambas lado a lado.
/// Todo lo que se edita aquí viaja a la sala como ops por entidad y aparece al instante en la
/// web; lo que se edita allá llega aquí igual. Esta parte tiene el estado, el 3D y la sala;
/// los paneles están en <c>EditorScreen.Panels.cs</c>.
/// </summary>
public partial class EditorScreen : Control, IEditorHost
{
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-CO");

    public enum ViewMode { Model3D, Plan, Split }

    private Main _main = null!;
    private string _projectId = "";
    private Node3D _world = null!;
    private SceneSync _sync = null!;
    private Atmosphere _atmosphere = null!;
    private OrbitCamera _camera = null!;
    private CollabClient? _collab;
    private bool _framed;
    private bool _closed;

    // estado de la edición
    private JsonObject? _model;
    private BuildingModel? _building;
    private readonly EditHistory _history = new();
    private List<string> _selection = [];
    private string? _levelId;
    private bool _gridSnap = true;
    private bool _showUpper = true;
    private string _catalogId = "sofa_3";
    private string _wallFinish = "ladrillo";
    private string _floorFinish = "madera_roble";
    private ViewMode _mode = ViewMode.Model3D;
    private readonly Dictionary<int, OrbitCamera.View> _bookmarks = [];

    // arrastre de muebles en 3D
    private JsonObject? _grabBase;
    private JsonObject? _grabDraft;
    private Vector3 _grabFrom;
    private float _grabY;
    private List<string> _grabIds = [];

    private readonly Dictionary<string, Node3D> _ghosts = [];
    private readonly List<GeometryInstance3D> _overlays = [];
    private IReadOnlyList<Peer> _peerList = [];
    private double _toastLeft;
    private ulong _lastPreview;

    /// <summary>Estado para pruebas y diagnóstico.</summary>
    public SceneSync Sync => _sync;
    public CollabClient? Collab => _collab;
    public bool Ready3D { get; private set; }
    public PlanView PlanView => _plan;
    public EditHistory History => _history;
    public ViewMode Mode => _mode;

    // ------------------------------------------------------------------ IEditorHost
    public JsonObject? Model => _model;
    public BuildingModel? Building => _building;
    public string? LevelId => _levelId;
    public IReadOnlyList<string> Selection => _selection;
    public IReadOnlyList<Peer> Peers => _peerList;
    public bool GridSnap => _gridSnap;
    public string CatalogId => _catalogId;
    public string WallFinish => _wallFinish;
    public string FloorFinish => _floorFinish;

    public void Build(Main main, Node3D worldHost, string projectId, string name)
    {
        _main = main;
        _projectId = projectId;
        MouseFilter = MouseFilterEnum.Ignore;
        SetAnchorsPreset(LayoutPreset.FullRect);

        // ---------------------------------------------------------------- mundo 3D
        _world = new Node3D { Name = "Escena" };
        worldHost.AddChild(_world);
        _atmosphere = new Atmosphere();
        _world.AddChild(_atmosphere);
        var ground = new MeshInstance3D
        {
            Mesh = new PlaneMesh { Size = new Vector2(400, 400) },
            MaterialOverride = Materials.Ground,
            Position = new Vector3(0, -0.02f, 0),
            Layers = SceneSync.OutdoorLayer,
        };
        _world.AddChild(ground);
        // el terreno sostiene al recorrido cuando sale de la casa
        var land = new StaticBody3D { CollisionLayer = MeshFactory.WalkLayer, CollisionMask = 0 };
        land.AddChild(new CollisionShape3D { Shape = new WorldBoundaryShape3D() });
        _world.AddChild(land);
        _sync = new SceneSync { Name = "Casa" };
        _world.AddChild(_sync);
        _camera = new OrbitCamera { Name = "Camara" };
        _world.AddChild(_camera);
        _camera.MakeCurrent();
        _camera.Clicked += Pick;
        _camera.TryGrab = TryGrab;
        _camera.Grabbed += GrabMove;
        _camera.Released += GrabEnd;
        _camera.Attributes = _atmosphere.CameraAttributes;
        _atmosphere.NightChanged += on => _sync.SetLamps(on);

        BuildPanels(name);
        BuildScenePanels();
        BuildWalkPanels();
    }

    // ------------------------------------------------------------------ carga y sala en vivo
    public async Task LoadAsync()
    {
        try
        {
            var project = await _main.Api.ProjectAsync(_projectId);
            _title.Text = project.Str("name") ?? _title.Text;
            if (project["model"] is JsonObject model) Show(model);
        }
        catch (Exception e) when (e is ApiException or HttpRequestException or TaskCanceledException)
        {
            _loading.Text = _main.Friendly(e);
            return;
        }
        StartLive();
    }

    private void StartLive()
    {
        var collab = new CollabClient(_main.Api, _projectId);
        _collab = collab;
        // todo llega desde un hilo de red: se copia ahí y se dibuja en el principal
        collab.Document.ViewChanged += view => OnMain(() => Show(view));
        collab.StatusChanged += (s, detail) => OnMain(() => ShowStatus(s, detail));
        collab.PeersChanged += () =>
        {
            var list = collab.Peers;
            OnMain(() => ShowPeers(list));
        };
        collab.RemoteEdit += peer => OnMain(() => Toast(peer is null ? "Cambios de otra persona" : peer.Client == "desktop" ? $"Cambios desde el escritorio ({peer.Name})" : $"Cambios de {peer.Name} en la web"));
        collab.Preview += (peer, entity) => OnMain(() => ShowGhost(peer, entity));
        collab.Error += msg => OnMain(() => Toast(msg));
        collab.Start();
    }

    /// <summary>Al hilo principal, salvo que la pantalla ya se haya cerrado.</summary>
    private void OnMain(Action action) => Main.Post(() =>
    {
        if (!_closed && IsInstanceValid(this)) action();
    });

    public void Close()
    {
        _closed = true;
        if (_collab is { } c)
        {
            _collab = null;
            _ = c.DisposeAsync().AsTask();
        }
        _world.QueueFree();
    }

    /// <summary>Dibuja el modelo vigente en el 3D, la planta y los paneles.</summary>
    private void Show(JsonObject model)
    {
        _model = model;
        _grabDraft = null;
        _sync.Apply(model);
        _building = _sync.Model;
        _plan.Draft = null;
        _loading.Visible = false;
        Ready3D = true;
        RefreshLevels();
        if (!_framed)
        {
            FrameHouse(true);
            _framed = true;
        }
        // lo elegido que ya no existe (otra persona lo borró) se suelta
        var alive = _selection.Where(id => ModelEditor.Find(model, id) is not null).ToList();
        if (alive.Count != _selection.Count) _selection = alive;
        Reselect();
        _plan.Refresh();
        RefreshInspector();
        _peopleDirty = 1.0;
    }

    // ------------------------------------------------------------------ editar
    public void Commit(JsonObject next, string label, IEnumerable<string>? select = null)
    {
        if (_model is null) return;
        _history.Record(label, _model, next);
        Publish(next, select);
    }

    /// <summary>Manda el modelo cambiado a la sala (como ops) y lo muestra ya, sin esperar al servidor.</summary>
    private void Publish(JsonObject next, IEnumerable<string>? select = null)
    {
        if (_collab is { } c)
        {
            if (c.Document.View is null)
            {
                Toast("Todavía no hay conexión con la sala: espera a que diga «en vivo»");
                Show(_model!);
                return;
            }
            Observe(c.EditAsync(next));
        }
        if (select is not null) _selection = select.Distinct().ToList();
        Show(next);
        UpdateUndoButtons();
        SendPresence();
    }

    private void Observe(Task task) => task.ContinueWith(t => OnMain(() => Toast($"No se pudo enviar el cambio: {t.Exception?.GetBaseException().Message}")), TaskContinuationOptions.OnlyOnFaulted);

    public void Undo()
    {
        if (_model is null || _history.Undo(_model) is not { } r)
        {
            Toast("No hay nada que deshacer");
            return;
        }
        Publish(r.Model);
        Toast($"Deshecho: {r.Label}");
    }

    public void Redo()
    {
        if (_model is null || _history.Redo(_model) is not { } r)
        {
            Toast("No hay nada que rehacer");
            return;
        }
        Publish(r.Model);
        Toast($"Rehecho: {r.Label}");
    }

    /// <summary>Una edición sobre lo elegido; si no aplica, se avisa.</summary>
    private void Edit(string label, Func<JsonObject, JsonObject> change, IEnumerable<string>? select = null)
    {
        if (_model is null) return;
        try
        {
            Commit(change(_model), label, select);
        }
        catch (EditException e)
        {
            Toast(e.Message);
        }
    }

    /// <summary>Agrega algo y lo deja elegido.</summary>
    private void Add(string label, Func<JsonObject, (JsonObject Model, string Id)> add)
    {
        if (_model is null) return;
        try
        {
            var (m, id) = add(_model);
            Commit(m, label, [id]);
        }
        catch (EditException e)
        {
            Toast(e.Message);
        }
    }

    public void ShowDraft(JsonObject? draft)
    {
        var shown = draft ?? _model;
        if (shown is null) return;
        _sync.Apply(shown);
        _plan.Draft = draft is null ? null : _sync.Model;
        _plan.QueueRedraw();
        Reselect();
    }

    public void Preview(string kind, string id, JsonObject? value)
    {
        if (_collab is not { Status: LiveStatus.Live } c || _levelId is null) return;
        var entity = value is null ? null : new JsonObject { ["k"] = kind, ["level"] = _levelId, ["id"] = id, ["v"] = value.DeepClone() };
        Observe(c.PreviewAsync(entity));
    }

    public void Select(IEnumerable<string> ids)
    {
        _selection = ids.Distinct().ToList();
        Reselect();
        _plan.QueueRedraw();
        RefreshInspector();
        SendPresence();
    }

    private void DeleteSelection()
    {
        if (_selection.Count == 0) return;
        var n = _selection.Count;
        Edit(n == 1 ? "Borrar" : $"Borrar {n} elementos", m => ModelEditor.Delete(m, _selection), []);
    }

    private void RotateSelection(double radians) =>
        Edit("Girar", m => ModelEditor.Rotate(m, _selection, radians), _selection);

    private void DuplicateSelection()
    {
        if (_model is null || _selection.Count == 0) return;
        try
        {
            var (m, ids) = ModelEditor.Duplicate(_model, _selection, new Point2(0.5, 0.5));
            Commit(m, "Duplicar", ids);
        }
        catch (EditException e)
        {
            Toast(e.Message);
        }
    }

    private void Nudge(Point2 d) => Edit("Mover", m => ModelEditor.Translate(m, _selection, d), _selection);

    private void SelectAll()
    {
        if (_building?.FindLevel(_levelId ?? "") is not { } lv) return;
        Select(lv.Walls.Select(w => w.Id).Concat(lv.Furniture.Select(f => f.Id)).Concat(lv.Columns.Select(c => c.Id)).Concat(lv.Rooms.Select(r => r.Id)));
    }

    // ------------------------------------------------------------------ cámara y pisos
    private void FrameHouse(bool instant)
    {
        if (_sync.Model is not { } m) return;
        var (min, max) = BuildingGeometry.Bounds(m);
        var top = m.Levels.Count == 0 ? 3 : m.Levels.Max(l => l.Elevation + BuildingGeometry.StoreyHeight(m, l));
        var center = new Vector3((float)(min.X + max.X) / 2, (float)top / 3, (float)(min.Y + max.Y) / 2);
        // media diagonal de la caja de la casa: así entra entera con el campo de visión de la cámara
        var radius = (float)Math.Sqrt(Math.Pow(max.X - min.X, 2) + Math.Pow(max.Y - min.Y, 2) + top * top) / 2;
        _camera.Frame(center, radius, instant);
        if (_mode != ViewMode.Model3D) _plan.Fit();
    }

    private void RefreshLevels()
    {
        if (_building is not { } m || m.Levels.Count == 0) return;
        if (_levelId is null || m.FindLevel(_levelId) is null) _levelId = m.Levels[0].Id;
        var names = m.Levels.Select(l => l.Name).ToList();
        if (_levelPick.ItemCount != names.Count || Enumerable.Range(0, names.Count).Any(i => _levelPick.GetItemText(i) != names[i]))
        {
            _levelPick.Clear();
            foreach (var n in names) _levelPick.AddItem(n);
        }
        var idx = m.Levels.ToList().FindIndex(l => l.Id == _levelId);
        if (_levelPick.Selected != idx) _levelPick.Select(idx);
        ApplyLevelFilter();
    }

    private void SetLevel(int index)
    {
        if (_building is not { } m || index < 0 || index >= m.Levels.Count) return;
        if (m.Levels[index].Id == _levelId) return;
        _plan.Tool.Cancel();
        _levelId = m.Levels[index].Id;
        _levelPick.Select(index);
        _selection.Clear();
        ApplyLevelFilter();
        _plan.Fit();
        Reselect();
        RefreshInspector();
        SendPresence();
    }

    private void ApplyLevelFilter()
    {
        if (_building is not { } m || m.FindLevel(_levelId ?? "") is not { } active) return;
        _sync.ShowLevels(l => _showUpper || Walking || l.Elevation <= active.Elevation + 0.01);
    }

    // ------------------------------------------------------------------ 3D: elegir, poner, pintar y arrastrar
    private (string Id, Vector3 Point)? RayHit(Vector2 screen)
    {
        var from = _camera.ProjectRayOrigin(screen);
        var to = from + _camera.ProjectRayNormal(screen) * 500;
        var hit = _camera.GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(from, to));
        if (hit.Count == 0 || hit["collider"].As<Node>() is not { } body || !body.HasMeta("entity")) return null;
        return (body.GetMeta("entity").AsString(), hit["position"].AsVector3());
    }

    /// <summary>Punto del plano horizontal a esa altura bajo el cursor.</summary>
    private Vector3? OnPlane(Vector2 screen, float y)
    {
        var from = _camera.ProjectRayOrigin(screen);
        var dir = _camera.ProjectRayNormal(screen);
        if (Math.Abs(dir.Y) < 1e-4) return null;
        var t = (y - from.Y) / dir.Y;
        return t > 0 ? from + dir * t : null;
    }

    private float ActiveElevation => (float)(_building?.FindLevel(_levelId ?? "")?.Elevation ?? 0);

    private void Pick(Vector2 screen)
    {
        var tool = _plan.Tool;
        if (tool is FurnitureTool or ColumnTool)
        {
            if (OnPlane(screen, ActiveElevation) is not { } p) return;
            var at = Snapping.ToGrid(new Point2(p.X, p.Z), 0.05);
            if (tool is FurnitureTool) Add("Agregar mueble", m => ModelEditor.AddFurniture(m, _levelId!, _catalogId, at));
            else Add("Agregar columna", m => ModelEditor.AddColumn(m, _levelId!, at));
            return;
        }
        var hit = RayHit(screen);
        var found = hit is { } h && _model is not null ? ModelEditor.Find(_model, h.Id) : null;
        if (tool is PaintTool)
        {
            PaintTool.Apply(this, found is null ? null : new Hit(found.Kind, hit!.Value.Id));
            return;
        }
        if (found is not null && found.Level.Str("id") is { } lid && lid != _levelId && _building is { } b)
        {
            // elegir algo de otro piso cambia el piso activo
            _levelId = lid;
            _levelPick.Select(b.Levels.ToList().FindIndex(l => l.Id == lid));
            ApplyLevelFilter();
            _plan.Fit();
        }
        if (hit is null) Select([]);
        else if (Input.IsKeyPressed(Key.Shift))
        {
            var sel = _selection.ToList();
            if (!sel.Remove(hit.Value.Id)) sel.Add(hit.Value.Id);
            Select(sel);
        }
        else Select([hit.Value.Id]);
    }

    private bool TryGrab(Vector2 screen)
    {
        if (_plan.Tool is not SelectTool || _model is null || RayHit(screen) is not { } hit || !_selection.Contains(hit.Id)) return false;
        if (ModelEditor.Find(_model, hit.Id) is not { Kind: "furniture" or "column" or "stair" } f) return false;
        var lv = _building?.FindLevel(f.Level.Str("id") ?? "");
        _grabY = (float)(lv?.Elevation ?? 0);
        if (OnPlane(screen, _grabY) is not { } p) return false;
        _grabFrom = p;
        _grabBase = _model;
        _grabIds = _selection.ToList();
        return true;
    }

    private void GrabMove(Vector2 screen)
    {
        if (_grabBase is null || OnPlane(screen, _grabY) is not { } p) return;
        var d = Snapping.ToGrid(new Point2(p.X - _grabFrom.X, p.Z - _grabFrom.Z), _gridSnap ? 0.05 : 0);
        _grabDraft = ModelEditor.Translate(_grabBase, _grabIds, d);
        ShowDraft(_grabDraft);
        if (_grabIds.Count == 1 && Time.GetTicksMsec() - _lastPreview > 50 && ModelEditor.Find(_grabDraft, _grabIds[0]) is { Kind: "furniture" } f)
        {
            _lastPreview = Time.GetTicksMsec();
            Preview("furniture", _grabIds[0], f.Entity);
        }
    }

    private void GrabEnd(Vector2 screen)
    {
        if (_grabDraft is { } draft) Commit(draft, _grabIds.Count == 1 ? "Mover" : $"Mover {_grabIds.Count} elementos", _grabIds);
        if (_grabDraft is not null) Preview("", "", null);
        _grabBase = _grabDraft = null;
    }

    private void SendPresence()
    {
        if (_collab is not { Status: LiveStatus.Live } c || _levelId is null) return;
        Observe(c.PresenceAsync(_levelId, _selection.FirstOrDefault(), _plan.Tool.GetType().Name.Replace("Tool", "").ToLowerInvariant()));
    }

    /// <summary>Resalta lo propio y lo que miran las demás personas (con su color).</summary>
    private void Reselect()
    {
        foreach (var o in _overlays.Where(GodotObject.IsInstanceValid)) o.MaterialOverlay = null;
        _overlays.Clear();
        if (_photo is { Visible: true }) return; // la foto sale limpia
        void Mark(string id, Color color)
        {
            foreach (var d in _sync.Find(id))
                foreach (var mi in d.Node.FindChildren("*", "MeshInstance3D", true, false).OfType<MeshInstance3D>())
                {
                    mi.MaterialOverlay = Materials.Highlight(color);
                    _overlays.Add(mi);
                }
        }
        foreach (var p in _peerList.Where(p => p.Selection is not null)) Mark(p.Selection!, Ui.PeerColor(p.Id));
        foreach (var id in _selection) Mark(id, Ui.Accent);
    }

    // ------------------------------------------------------------------ presencia y avisos
    private void ShowStatus(LiveStatus s, string? detail)
    {
        (_status.Text, var color) = s switch
        {
            LiveStatus.Live => ("● en vivo", Ui.Live),
            LiveStatus.Connecting => ("conectando…", Ui.Muted),
            LiveStatus.Offline => ("sin conexión · tus cambios esperan", Ui.Danger),
            LiveStatus.Closed => (detail ?? "la sala se cerró", Ui.Danger),
            _ => ("", Ui.Muted),
        };
        _status.AddThemeColorOverride("font_color", color);
        if (s == LiveStatus.Live) SendPresence();
    }

    private void ShowPeers(IReadOnlyList<Peer> peers)
    {
        _peerList = peers;
        foreach (var c in _peers.GetChildren()) c.QueueFree();
        foreach (var p in peers)
        {
            var chip = new PanelContainer { TooltipText = $"{p.Name} · {(p.Client == "desktop" ? "escritorio" : "web")}" };
            chip.AddThemeStyleboxOverride("panel", Ui.Box(Ui.PeerColor(p.Id), 999, null, 6));
            var initials = string.Concat(p.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(w => char.ToUpperInvariant(w[0])));
            chip.AddChild(Ui.Text($"{initials} {(p.Client == "desktop" ? "▣" : "◍")}", 12, Ui.Paper));
            _peers.AddChild(chip);
        }
        Reselect();
        _plan.QueueRedraw();
    }

    public void Toast(string text)
    {
        _toast.Text = text;
        ((Control)_toast.GetParent()).Visible = true;
        _toastLeft = 4;
    }

    public override void _Process(double delta)
    {
        if (_toastLeft > 0 && (_toastLeft -= delta) <= 0) ((Control)_toast.GetParent()).Visible = false;
        UpdateFps(delta);
        UpdateWalk(delta);
    }

    /// <summary>Fantasma de lo que otra persona arrastra (muro, mueble o abertura).</summary>
    private void ShowGhost(string peerId, JsonObject? entity)
    {
        if (_ghosts.Remove(peerId, out var old)) old.QueueFree();
        if (entity is null || _sync.Model is not { } m) return;
        var level = m.FindLevel(entity.Str("level") ?? "");
        if (level is null || entity["v"] is not JsonObject v) return;
        var color = Ui.PeerColor(peerId);
        var node = new Node3D();
        switch (entity.Str("k"))
        {
            case "wall":
                var wall = BuildingModel.ParseWall(v);
                foreach (var b in BuildingGeometry.WallPieces(wall, level.Elevation)) node.AddChild(MeshFactory.Box(b, Materials.Ghost(color), "", pickable: false));
                break;
            case "furniture":
                var f = BuildingModel.ParseFurniture(v);
                node.AddChild(MeshFactory.Box(BuildingGeometry.FurnitureBox(f, level.Elevation), Materials.Ghost(color), "", pickable: false));
                break;
            case "opening":
                var host = level.Walls.FirstOrDefault(w => w.Id == v.Str("wall"));
                if (host is null) return;
                var kind = v.Str("kind") ?? "door";
                var o = new Opening(entity.Str("id") ?? "", kind, Num(v, "offset"), Num(v, "width"), kind == "window" ? 1.2 : 2.1, kind == "window" ? 0.9 : 0);
                node.AddChild(MeshFactory.Box(BuildingGeometry.OpeningInfill(host, o, level.Elevation) with { Size = new Vec3(o.Width, o.Height, host.Thickness + 0.04) }, Materials.Ghost(color), "", pickable: false));
                break;
            default:
                return;
        }
        _world.AddChild(node);
        _ghosts[peerId] = node;
    }

    private static double Num(JsonObject o, string key) => o[key] is JsonValue v ? JsonUtil.AsDouble(v) : 0;
}
