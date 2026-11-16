using System.Text.Json.Nodes;
using Godot;
using Plano3D.Core.Editing;
using Plano3D.Core.Model;

namespace Plano3D.App.Plan;

/// <summary>
/// Herramienta de la planta (patrón State: la vista delega el mouse y el teclado en la que
/// esté activa). Toda edición sale por <see cref="IEditorHost.Commit"/>.
/// </summary>
public abstract class PlanTool
{
    protected PlanView V = null!;
    protected IEditorHost H = null!;

    public void Attach(PlanView view, IEditorHost host)
    {
        V = view;
        H = host;
        OnAttach();
    }

    public abstract string Name { get; }
    public abstract string Hint { get; }
    /// <summary>A mitad de algo (un muro empezado): el clic derecho y Esc lo cancelan.</summary>
    public virtual bool Busy => false;

    protected virtual void OnAttach() { }
    public virtual void Press(Point2 p, InputEventMouseButton e) { }
    public virtual void DoubleClick(Point2 p) { }
    public virtual void Move(Point2 p, InputEventMouseMotion e) { }
    public virtual void Release(Point2 p, InputEventMouseButton e) { }
    public virtual bool OnKey(InputEventKey k) => false;
    public virtual void Cancel() { }
    public virtual void Draw(PlanView v) { }

    protected Level? Level => H.Building?.FindLevel(H.LevelId ?? "");
    /// <summary>Tolerancia de 8 px, en metros.</summary>
    protected double Tol => 8 / V.Zoom;
    protected double Grid => H.GridSnap ? 0.05 : 0;

    protected List<Guide> Guides = [];

    /// <summary>Imán completo: esquinas de muros, ejes respecto del ancla, guías y rejilla.</summary>
    protected Point2 Snap(Point2 p, Point2? anchor = null, string? exceptWall = null)
    {
        var corners = Level is { } lv ? Snapping.WallEndpoints(lv.Walls, exceptWall).ToList() : [];
        var (point, guides) = Snapping.WithGuides(p, corners, Tol * 1.2, anchor, Grid);
        Guides = guides;
        return point;
    }

    /// <summary>Ejecuta una edición del núcleo; si no tiene sentido, avisa en vez de romper.</summary>
    protected bool Try(Func<(JsonObject Model, string Label, IEnumerable<string>? Select)> edit)
    {
        if (H.Model is null || H.LevelId is null) return false;
        try
        {
            var (model, label, select) = edit();
            H.Commit(model, label, select);
            return true;
        }
        catch (EditException e)
        {
            H.Toast(e.Message);
            return false;
        }
    }

    protected void DrawGuides(PlanView v)
    {
        foreach (var g in Guides) v.DrawDashedLine(v.ToScreen(g.From), v.ToScreen(g.To), new Color(Ui.Accent, 0.7f), 1, 6);
    }

    protected static void DrawCursor(PlanView v, Point2 p)
    {
        var s = v.ToScreen(p);
        v.DrawCircle(s, 4, Ui.Accent);
        v.DrawArc(s, 8, 0, Mathf.Tau, 20, new Color(Ui.Accent, 0.5f), 1);
    }
}

/// <summary>Elegir (V): clic, Mayús+clic suma, arrastrar mueve, recuadro elige varios, esquinas de muro con sus asas.</summary>
public sealed class SelectTool : PlanTool
{
    private enum Mode { Idle, Pressing, Moving, Corner, Box }

    private Mode _mode;
    private Point2 _start;
    private Point2 _now;
    private JsonObject? _base;
    private JsonObject? _draft;
    private List<string> _ids = [];
    private string? _wall;
    private bool _end;
    private ulong _lastPreview;

    public override string Name => "Elegir";
    public override string Hint => "clic elige · Mayús suma · arrastra para mover · Supr borra · R gira";
    public override bool Busy => _mode is Mode.Moving or Mode.Corner or Mode.Box;

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        if (Level is not { } lv || H.Model is null) return;
        _start = _now = p;
        _base = H.Model;
        // asas de las esquinas del muro elegido
        if (H.Selection.Count == 1 && lv.Walls.FirstOrDefault(w => w.Id == H.Selection[0]) is { } sw)
            foreach (var (pt, end) in new[] { (sw.Start, false), (sw.End, true) })
                if (Snapping.Distance(pt, p) <= Tol * 1.3)
                {
                    _mode = Mode.Corner;
                    _wall = sw.Id;
                    _end = end;
                    return;
                }
        var hit = PlanHit.At(lv, p, Tol);
        if (hit is null)
        {
            if (!e.ShiftPressed) H.Select([]);
            _mode = Mode.Box;
            return;
        }
        if (e.ShiftPressed)
        {
            var sel = H.Selection.ToList();
            if (!sel.Remove(hit.Id)) sel.Add(hit.Id);
            H.Select(sel);
            _mode = Mode.Idle;
            return;
        }
        if (!H.Selection.Contains(hit.Id)) H.Select([hit.Id]);
        _ids = H.Selection.ToList();
        _mode = Mode.Pressing;
    }

    public override void Move(Point2 p, InputEventMouseMotion e)
    {
        _now = p;
        if (_mode == Mode.Idle)
        {
            V.Hover = Level is { } lv ? PlanHit.At(lv, p, Tol) : null;
            return;
        }
        if (_mode == Mode.Pressing && (V.ToScreen(p) - V.ToScreen(_start)).Length() > 4) _mode = Mode.Moving;
        if (_mode == Mode.Moving && _base is not null)
        {
            var d = p - _start;
            if (Grid > 0) d = Snapping.ToGrid(d, Grid);
            _draft = ModelEditor.Translate(_base, _ids, d);
            H.ShowDraft(_draft);
            SendPreview();
        }
        else if (_mode == Mode.Corner && _base is not null && _wall is not null && Level?.Walls.FirstOrDefault(w => w.Id == _wall) is { } wall)
        {
            var anchor = _end ? wall.Start : wall.End;
            var target = Snap(p, anchor, _wall);
            try
            {
                _draft = ModelEditor.MoveWallPoint(_base, _wall, _end, target, joint: !e.AltPressed);
                H.ShowDraft(_draft);
                SendPreview();
            }
            catch (EditException)
            {
            }
        }
    }

    /// <summary>A las demás personas: el fantasma del mueble o muro que se arrastra (20 por segundo).</summary>
    private void SendPreview()
    {
        if (Time.GetTicksMsec() - _lastPreview < 50 || _draft is null) return;
        _lastPreview = Time.GetTicksMsec();
        var id = _mode == Mode.Corner ? _wall : _ids.Count == 1 ? _ids[0] : null;
        if (id is null || ModelEditor.Find(_draft, id) is not { } f || f.Kind is not ("wall" or "furniture")) return;
        H.Preview(f.Kind, id, f.Entity);
    }

    public override void Release(Point2 p, InputEventMouseButton e)
    {
        switch (_mode)
        {
            case Mode.Moving or Mode.Corner when _draft is not null:
                var label = _mode == Mode.Corner ? "Mover esquina" : _ids.Count == 1 ? "Mover" : $"Mover {_ids.Count} elementos";
                H.Commit(_draft, label, H.Selection);
                H.Preview("", "", null);
                break;
            case Mode.Box when Level is { } lv && (V.ToScreen(p) - V.ToScreen(_start)).Length() > 4:
                var boxed = PlanHit.InBox(lv, _start, p).Select(h => h.Id);
                H.Select(e.ShiftPressed ? H.Selection.Union(boxed) : boxed);
                break;
        }
        Reset();
    }

    public override void Cancel()
    {
        if (_mode is Mode.Moving or Mode.Corner)
        {
            H.ShowDraft(null);
            H.Preview("", "", null);
        }
        Reset();
    }

    private void Reset()
    {
        _mode = Mode.Idle;
        _draft = null;
        _base = null;
        Guides = [];
    }

    public override bool OnKey(InputEventKey k)
    {
        if (k.Keycode != Key.Escape || !Busy) return false;
        Cancel();
        return true;
    }

    public override void Draw(PlanView v)
    {
        DrawGuides(v);
        if (_mode == Mode.Box)
        {
            var a = v.ToScreen(_start);
            var b = v.ToScreen(_now);
            var rect = new Rect2(new Vector2(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y)), (b - a).Abs());
            v.DrawRect(rect, new Color(Ui.Accent, 0.08f));
            v.DrawRect(rect, new Color(Ui.Accent, 0.7f), false, 1);
        }
        if (_mode == Mode.Moving)
        {
            var d = _now - _start;
            v.Tag(v.ToScreen(_now) + new Vector2(0, -24), $"Δ {PlanView.Meters(Snapping.ToGrid(d, 0.01).Length)}");
        }
        if (_mode == Mode.Corner && V.Draft?.FindLevel(H.LevelId ?? "")?.Walls.FirstOrDefault(w => w.Id == _wall) is { } w)
            v.Tag(v.ToScreen((w.Start + w.End) * 0.5) + new Vector2(0, -18), PlanView.Meters(w.Length));
    }
}

/// <summary>Muro (W): clic para empezar, clic para terminar y seguir encadenando; Esc o clic derecho para soltar.</summary>
public sealed class WallTool : PlanTool
{
    private Point2? _anchor;
    private Point2? _first;
    private Point2 _cursor;

    public override string Name => "Muro";
    public override string Hint => "clic para empezar y para cada esquina · Esc termina · imán a esquinas y ejes";
    public override bool Busy => _anchor is not null;

    public override void Move(Point2 p, InputEventMouseMotion e) => _cursor = Snap(p, _anchor);

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        var point = Snap(p, _anchor);
        if (_anchor is not { } a)
        {
            _anchor = _first = point;
            return;
        }
        var ok = Try(() =>
        {
            var (m, id) = ModelEditor.AddWall(H.Model!, H.LevelId!, a, point);
            return (m, "Agregar muro", [id]);
        });
        if (!ok) return;
        // cerrar el contorno en la primera esquina termina la cadena
        if (_first is { } f && Snapping.Distance(f, point) < 1e-6) Cancel();
        else _anchor = point;
    }

    public override void DoubleClick(Point2 p) => Cancel();

    public override bool OnKey(InputEventKey k)
    {
        if (k.Keycode is not (Key.Escape or Key.Enter) || _anchor is null) return false;
        Cancel();
        return true;
    }

    public override void Cancel()
    {
        _anchor = _first = null;
        Guides = [];
    }

    public override void Draw(PlanView v)
    {
        DrawGuides(v);
        if (_anchor is { } a)
        {
            var len = Snapping.Distance(a, _cursor);
            if (len > 1e-3)
            {
                var dir = (_cursor - a).Normalized;
                v.DrawColoredPolygon(v.ToScreen(Shapes.Rect((a + _cursor) * 0.5, len, 0.15, Math.Atan2(dir.Y, dir.X))), new Color(Ui.Accent, 0.55f));
                v.Tag(v.ToScreen((a + _cursor) * 0.5) + new Vector2(0, -20), PlanView.Meters(len));
            }
        }
        DrawCursor(v, _cursor);
    }
}

/// <summary>Puerta (D) o ventana (N): se pasea sobre el muro más cercano y un clic la pone.</summary>
public sealed class OpeningTool(string kind) : PlanTool
{
    private (Wall Wall, double Offset, double Width, bool Ok)? _spot;

    public override string Name => kind == "window" ? "Ventana" : "Puerta";
    public override string Hint => $"pasa sobre un muro y haz clic para poner la {Name.ToLowerInvariant()}";

    public override void Move(Point2 p, InputEventMouseMotion e)
    {
        _spot = null;
        if (Level is not { } lv || Snapping.NearestWall(lv, p, Tol * 2) is not { } near) return;
        var spec = kind == "window" ? ModelEditor.Window : ModelEditor.Door;
        var width = Math.Min(spec.Width, near.Wall.Length * 0.9);
        var (offset, ok) = ModelEditor.Place(near.Wall, width, near.Offset);
        _spot = (near.Wall, offset, width, ok);
    }

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        Move(p, new InputEventMouseMotion());
        if (_spot is not { } s)
        {
            H.Toast("Las puertas y ventanas van sobre un muro");
            return;
        }
        Try(() =>
        {
            var (m, id) = ModelEditor.AddOpening(H.Model!, s.Wall.Id, kind, s.Offset + s.Width / 2);
            return (m, kind == "window" ? "Agregar ventana" : "Agregar puerta", [id]);
        });
    }

    public override void Draw(PlanView v)
    {
        if (_spot is not { } s) return;
        var dir = s.Wall.Direction;
        var a = s.Wall.Start + dir * s.Offset;
        var b = a + dir * s.Width;
        var color = s.Ok ? new Color(Ui.Live, 0.75f) : new Color(Ui.Danger, 0.75f);
        v.DrawColoredPolygon(v.ToScreen(Shapes.Rect((a + b) * 0.5, s.Width, s.Wall.Thickness + 0.08, Math.Atan2(dir.Y, dir.X))), color);
        // cotas vivas a cada lado
        var after = s.Wall.Length - s.Offset - s.Width;
        v.Tag(v.ToScreen(s.Wall.Start + dir * (s.Offset / 2)) + new Vector2(0, -18), PlanView.Meters(s.Offset));
        v.Tag(v.ToScreen(b + dir * (after / 2)) + new Vector2(0, -18), PlanView.Meters(after));
    }
}

/// <summary>Ambiente (H): clic en cada esquina; clic en la primera, doble clic o Enter lo cierra.</summary>
public sealed class RoomTool : PlanTool
{
    private readonly List<Point2> _points = [];
    private Point2 _cursor;

    public override string Name => "Ambiente";
    public override string Hint => "clic en cada esquina · Enter o clic en la primera cierra · Retroceso quita";
    public override bool Busy => _points.Count > 0;

    public override void Move(Point2 p, InputEventMouseMotion e) => _cursor = Snap(p, _points.Count > 0 ? _points[^1] : null);

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        var point = Snap(p, _points.Count > 0 ? _points[^1] : null);
        if (_points.Count >= 3 && Snapping.Distance(point, _points[0]) <= Tol * 1.5)
        {
            Finish();
            return;
        }
        _points.Add(point);
    }

    public override void DoubleClick(Point2 p) => Finish();

    private void Finish()
    {
        if (_points.Count < 3) return;
        var count = Level?.Rooms.Count ?? 0;
        var poly = _points.ToList();
        if (Try(() =>
        {
            var (m, id) = ModelEditor.AddRoom(H.Model!, H.LevelId!, poly, $"Ambiente {count + 1}");
            return (m, "Agregar ambiente", [id]);
        }))
            Cancel();
    }

    public override bool OnKey(InputEventKey k)
    {
        switch (k.Keycode)
        {
            case Key.Enter when _points.Count >= 3:
                Finish();
                return true;
            case Key.Backspace when _points.Count > 0:
                _points.RemoveAt(_points.Count - 1);
                return true;
            case Key.Escape when _points.Count > 0:
                Cancel();
                return true;
        }
        return false;
    }

    public override void Cancel()
    {
        _points.Clear();
        Guides = [];
    }

    public override void Draw(PlanView v)
    {
        DrawGuides(v);
        if (_points.Count > 0)
        {
            var pts = v.ToScreen(_points.Append(_cursor));
            if (pts.Length >= 3 && Geometry2D.TriangulatePolygon(pts).Length > 0) v.DrawColoredPolygon(pts, new Color(Ui.Accent, 0.12f));
            v.DrawPolyline(pts, Ui.Accent, 2);
            foreach (var p in _points) v.DrawCircle(v.ToScreen(p), 4, Ui.Accent);
        }
        DrawCursor(v, _cursor);
    }
}

/// <summary>Columna (O): un clic, 30 × 30 cm.</summary>
public sealed class ColumnTool : PlanTool
{
    private Point2 _cursor;
    public override string Name => "Columna";
    public override string Hint => "clic para poner una columna de 30 × 30 cm";
    public override void Move(Point2 p, InputEventMouseMotion e) => _cursor = Snap(p);

    public override void Press(Point2 p, InputEventMouseButton e) => Try(() =>
    {
        var (m, id) = ModelEditor.AddColumn(H.Model!, H.LevelId!, Snap(p));
        return (m, "Agregar columna", [id]);
    });

    public override void Draw(PlanView v)
    {
        DrawGuides(v);
        v.DrawColoredPolygon(v.ToScreen(Shapes.Rect(_cursor, 0.3, 0.3, 0)), new Color(Ui.Accent, 0.5f));
    }
}

/// <summary>Mueble (P): la pieza del catálogo sigue al cursor; R la gira 90° (Mayús+R, 15°) y un clic la pone.</summary>
public sealed class FurnitureTool : PlanTool
{
    private Point2 _cursor;
    private double _rotation;

    public override string Name => "Mueble";
    public override string Hint => "clic para poner · R gira 90° · Mayús+R gira 15°";

    public override void Move(Point2 p, InputEventMouseMotion e) => _cursor = Grid > 0 ? Snapping.ToGrid(p, Grid) : p;

    public override void Press(Point2 p, InputEventMouseButton e) => Try(() =>
    {
        var (m, id) = ModelEditor.AddFurniture(H.Model!, H.LevelId!, H.CatalogId, _cursor, _rotation);
        return (m, $"Agregar {Catalog.Item(H.CatalogId)?.Name.ToLowerInvariant() ?? "mueble"}", [id]);
    });

    public override bool OnKey(InputEventKey k)
    {
        if (k.Keycode != Key.R) return false;
        _rotation += k.ShiftPressed ? Math.PI / 12 : Math.PI / 2;
        return true;
    }

    public override void Draw(PlanView v)
    {
        if (Catalog.Item(H.CatalogId) is not { } item) return;
        var pts = v.ToScreen(Shapes.Rect(_cursor, item.Width, item.Depth, _rotation));
        v.DrawColoredPolygon(pts, new Color(Ui.Accent, 0.25f));
        v.DrawPolyline([.. pts, pts[0]], Ui.Accent, 1.5f);
        v.DrawLine(pts[2], pts[3], Ui.Accent, 3);
        v.Tag(v.ToScreen(_cursor) + new Vector2(0, -(float)(item.Depth * v.Zoom / 2) - 18), item.Name);
    }
}

/// <summary>Medir (M): dos clics; muestra la distancia y sus componentes.</summary>
public sealed class MeasureTool : PlanTool
{
    private Point2? _a;
    private Point2? _b;
    private Point2 _cursor;

    public override string Name => "Medir";
    public override string Hint => "clic en dos puntos para medir (imán a esquinas)";
    public override bool Busy => _a is not null && _b is null;

    public override void Move(Point2 p, InputEventMouseMotion e) => _cursor = Snap(p, _b is null ? _a : null);

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        var point = Snap(p, _b is null ? _a : null);
        if (_a is null || _b is not null)
        {
            _a = point;
            _b = null;
        }
        else _b = point;
    }

    public override void Cancel()
    {
        _a = _b = null;
        Guides = [];
    }

    public override void Draw(PlanView v)
    {
        DrawGuides(v);
        DrawCursor(v, _cursor);
        if (_a is not { } a) return;
        var b = _b ?? _cursor;
        v.DrawLine(v.ToScreen(a), v.ToScreen(b), Ui.Accent, 2);
        v.DrawCircle(v.ToScreen(a), 4, Ui.Accent);
        var d = b - a;
        v.Tag(v.ToScreen((a + b) * 0.5) + new Vector2(0, -20), $"{PlanView.Meters(d.Length)}  (↔ {Math.Abs(d.X):0.00} · ↕ {Math.Abs(d.Y):0.00})");
    }
}

/// <summary>Pintar (B): un clic aplica el acabado elegido a un muro o al piso de un ambiente.</summary>
public sealed class PaintTool : PlanTool
{
    public override string Name => "Pintar";
    public override string Hint => "clic en un muro o un ambiente para aplicar el acabado elegido";

    public override void Move(Point2 p, InputEventMouseMotion e) =>
        V.Hover = Level is { } lv && PlanHit.At(lv, p, Tol) is { Kind: "wall" or "room" } h ? h : null;

    public override void Press(Point2 p, InputEventMouseButton e)
    {
        if (Level is not { } lv) return;
        Apply(H, PlanHit.At(lv, p, Tol));
    }

    /// <summary>Lo usa también la vista 3D (clic sobre una superficie).</summary>
    public static void Apply(IEditorHost host, Hit? hit)
    {
        if (host.Model is null) return;
        try
        {
            switch (hit?.Kind)
            {
                case "wall":
                    host.Commit(ModelEditor.Patch(host.Model, hit.Id, "material", host.WallFinish), $"Pintar muro: {Catalog.WallFinish(host.WallFinish)?.Name}");
                    break;
                case "room":
                    host.Commit(ModelEditor.Patch(host.Model, hit.Id, "floor_material", host.FloorFinish), $"Piso: {Catalog.FloorFinish(host.FloorFinish)?.Name}");
                    break;
                default:
                    host.Toast("Se pintan los muros y los pisos de los ambientes");
                    break;
            }
        }
        catch (EditException e)
        {
            host.Toast(e.Message);
        }
    }
}
