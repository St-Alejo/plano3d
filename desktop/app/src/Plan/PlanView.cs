using System.Globalization;
using Godot;
using Plano3D.Core.Editing;
using Plano3D.Core.Geometry;
using Plano3D.Core.Model;

namespace Plano3D.App.Plan;

/// <summary>
/// La planta de un piso, dibujada a mano con <c>_Draw</c> (patrón Observer: se redibuja al
/// cambiar el modelo, la selección o la herramienta). Rueda para acercar, botón derecho o
/// central para desplazar; el botón izquierdo es de la herramienta activa.
/// </summary>
public partial class PlanView : Control
{
    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-CO");
    private static readonly Color Paper = new("f7f5ef");
    private static readonly Color GridMinor = new(0, 0, 0, 0.04f);
    private static readonly Color GridMajor = new(0, 0, 0, 0.08f);
    private static readonly Color WallInk = new("2f2c27");
    private static readonly Color Below = new(0, 0, 0, 0.12f);

    private IEditorHost _host = null!;
    private PlanTool _tool = null!;
    private Vector2 _pan;
    private float _scale = 40;
    private Vector2? _panFrom;
    private bool _fitted;
    private Vector2 _mouse;

    /// <summary>Píxeles por metro.</summary>
    public float Zoom => _scale;
    /// <summary>Borrador de un arrastre: se dibuja en lugar del modelo.</summary>
    public BuildingModel? Draft { get; set; }
    public Hit? Hover { get; set; }
    public Point2 Cursor { get; private set; }
    public PlanTool Tool => _tool;
    public Font Font => GetThemeDefaultFont();

    public void Setup(IEditorHost host, PlanTool tool)
    {
        _host = host;
        ClipContents = true;
        FocusMode = FocusModeEnum.Click;
        MouseFilter = MouseFilterEnum.Stop;
        SetTool(tool);
        Resized += () => QueueRedraw();
    }

    public void SetTool(PlanTool tool)
    {
        _tool?.Cancel();
        _tool = tool;
        tool.Attach(this, _host);
        Hover = null;
        MouseDefaultCursorShape = tool is SelectTool ? CursorShape.Arrow : CursorShape.Cross;
        QueueRedraw();
    }

    // ------------------------------------------------------------------ coordenadas
    public Vector2 ToScreen(Point2 p) => new Vector2((float)p.X, (float)p.Y) * _scale + _pan;

    public Point2 ToWorld(Vector2 s) => new((s.X - _pan.X) / _scale, (s.Y - _pan.Y) / _scale);

    public Vector2[] ToScreen(IEnumerable<Point2> pts) => pts.Select(ToScreen).ToArray();

    /// <summary>Encuadra el piso activo (o la casa si el piso está vacío).</summary>
    public void Fit()
    {
        if (_host.Building is not { } m || Size.X < 10) return;
        var level = m.FindLevel(_host.LevelId ?? "");
        var pts = level is null ? [] : level.Walls.SelectMany(w => new[] { w.Start, w.End }).Concat(level.Rooms.SelectMany(r => r.Polygon)).ToList();
        Point2 min, max;
        if (pts.Count == 0) (min, max) = BuildingGeometry.Bounds(m);
        else
        {
            min = new Point2(pts.Min(p => p.X), pts.Min(p => p.Y));
            max = new Point2(pts.Max(p => p.X), pts.Max(p => p.Y));
        }
        var w = Math.Max(1, max.X - min.X);
        var h = Math.Max(1, max.Y - min.Y);
        _scale = (float)Math.Clamp(Math.Min((Size.X - 160) / w, (Size.Y - 200) / h), 8, 400);
        var center = new Vector2((float)(min.X + max.X) / 2, (float)(min.Y + max.Y) / 2);
        _pan = Size / 2 - center * _scale + new Vector2(0, 20);
        _fitted = true;
        QueueRedraw();
    }

    public void Refresh()
    {
        if (!_fitted) Fit();
        QueueRedraw();
    }

    // ------------------------------------------------------------------ entrada
    public override void _GuiInput(InputEvent e)
    {
        switch (e)
        {
            case InputEventMouseButton { ButtonIndex: MouseButton.WheelUp or MouseButton.WheelDown, Pressed: true } wheel:
                var before = ToWorld(wheel.Position);
                _scale = Math.Clamp(_scale * (wheel.ButtonIndex == MouseButton.WheelUp ? 1.15f : 1 / 1.15f), 6, 600);
                _pan = wheel.Position - new Vector2((float)before.X, (float)before.Y) * _scale;
                QueueRedraw();
                AcceptEvent();
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.Right or MouseButton.Middle } mb:
                if (mb.Pressed && mb.ButtonIndex == MouseButton.Right && _tool.Busy)
                {
                    _tool.Cancel();
                    QueueRedraw();
                }
                else _panFrom = mb.Pressed ? mb.Position : null;
                AcceptEvent();
                break;
            case InputEventMouseButton { ButtonIndex: MouseButton.Left } left:
                GrabFocus();
                Cursor = ToWorld(left.Position);
                if (left.Pressed)
                {
                    if (left.DoubleClick) _tool.DoubleClick(Cursor);
                    else _tool.Press(Cursor, left);
                }
                else _tool.Release(Cursor, left);
                QueueRedraw();
                AcceptEvent();
                break;
            case InputEventMouseMotion mm:
                _mouse = mm.Position;
                if (_panFrom is { } from)
                {
                    _pan += mm.Position - from;
                    _panFrom = mm.Position;
                }
                else
                {
                    Cursor = ToWorld(mm.Position);
                    _tool.Move(Cursor, mm);
                }
                QueueRedraw();
                AcceptEvent();
                break;
        }
    }

    // ------------------------------------------------------------------ dibujo
    public override void _Draw()
    {
        DrawRect(new Rect2(Vector2.Zero, Size), Paper);
        DrawGrid();
        var model = Draft ?? _host.Building;
        if (model?.FindLevel(_host.LevelId ?? "") is not { } level) return;

        // el piso de abajo, tenue, como referencia para calcar
        var idx = model.Levels.ToList().FindIndex(l => l.Id == level.Id);
        if (idx > 0)
            foreach (var w in model.Levels[idx - 1].Walls) DrawColoredPolygon(ToScreen(Shapes.Wall(w)), Below);

        foreach (var r in level.Rooms) DrawRoom(r);
        foreach (var s in level.Stairs) DrawStair(s);
        foreach (var w in level.Walls) DrawWall(w);
        foreach (var c in level.Columns) DrawColoredPolygon(ToScreen(Shapes.Column(c)), WallInk);
        foreach (var f in level.Furniture) DrawFurniture(f);

        // selección de las demás personas, con su color
        foreach (var p in _host.Peers.Where(p => p.Selection is not null && p.Level == level.Id))
            Outline(level, p.Selection!, Ui.PeerColor(p.Id), 2.5f);
        if (Hover is { } h && !_host.Selection.Contains(h.Id)) Outline(level, h.Id, new Color(Ui.Accent, 0.45f), 2);
        foreach (var id in _host.Selection) Outline(level, id, Ui.Accent, 3);

        _tool.Draw(this);
        DrawFooter();
    }

    private void DrawGrid()
    {
        var a = ToWorld(Vector2.Zero);
        var b = ToWorld(Size);
        void Lines(double step, Color color)
        {
            if (step * _scale < 7) return;
            for (var x = Math.Floor(a.X / step) * step; x <= b.X; x += step)
            {
                var sx = ToScreen(new Point2(x, 0)).X;
                DrawLine(new Vector2(sx, 0), new Vector2(sx, Size.Y), color);
            }
            for (var y = Math.Floor(a.Y / step) * step; y <= b.Y; y += step)
            {
                var sy = ToScreen(new Point2(0, y)).Y;
                DrawLine(new Vector2(0, sy), new Vector2(Size.X, sy), color);
            }
        }
        Lines(0.5, GridMinor);
        Lines(1, GridMajor);
    }

    private void DrawRoom(Room r)
    {
        if (r.Polygon.Count < 3) return;
        var pts = ToScreen(r.Polygon);
        var fill = Catalog.FloorFinish(r.FloorMaterial) is { } fin ? new Color(fin.Color) { A = 0.28f } : new Color(Ui.Accent, 0.06f);
        if (Geometry2D.TriangulatePolygon(pts).Length > 0) DrawColoredPolygon(pts, fill);
        var area = Math.Abs(BuildingGeometry.SignedArea(r.Polygon));
        var center = ToScreen(Shapes.Centroid(r.Polygon));
        if (_scale * Math.Sqrt(area) < 50) return;
        var name = string.IsNullOrWhiteSpace(r.Label) ? "Ambiente" : r.Label;
        DrawString(Font, center + new Vector2(-80, -2), name, HorizontalAlignment.Center, 160, 13, new Color(Ui.Ink, 0.75f));
        DrawString(Font, center + new Vector2(-80, 14), $"{area.ToString("0.0", Es)} m²", HorizontalAlignment.Center, 160, 11, Ui.Muted);
    }

    private void DrawWall(Wall w)
    {
        var dir = w.Direction;
        var normal = new Point2(-dir.Y, dir.X);
        var cursor = 0.0;
        void Solid(double from, double to)
        {
            if (to - from < 1e-4) return;
            var mid = w.Start + dir * ((from + to) / 2);
            DrawColoredPolygon(ToScreen(Shapes.Rect(mid, to - from, w.Thickness, Math.Atan2(dir.Y, dir.X))), WallInk);
        }
        foreach (var o in w.OpeningsOrEmpty.OrderBy(o => o.Offset))
        {
            Solid(cursor, Math.Clamp(o.Offset, 0, w.Length));
            cursor = Math.Max(cursor, Math.Clamp(o.Offset + o.Width, 0, w.Length));
            var (a, b) = Shapes.Opening(w, o);
            if (o.IsDoor)
            {
                // hoja abierta 90° y su barrido
                var leaf = a + normal * o.Width;
                DrawLine(ToScreen(a), ToScreen(leaf), WallInk, 1.5f);
                var start = Math.Atan2(normal.Y, normal.X);
                var end = Math.Atan2(dir.Y, dir.X);
                if (Math.Abs(end - start) > Math.PI) end += end < start ? 2 * Math.PI : -2 * Math.PI;
                DrawArc(ToScreen(a), (float)(o.Width * _scale), (float)start, (float)end, 24, new Color(WallInk, 0.5f), 1);
            }
            else
            {
                var half = normal * (w.Thickness / 2);
                DrawColoredPolygon(ToScreen([a - half, b - half, b + half, a + half]), new Color("dcebf0"));
                DrawLine(ToScreen(a - half * 0.3), ToScreen(b - half * 0.3), new Color("5d8796"), 1.2f);
                DrawLine(ToScreen(a + half * 0.3), ToScreen(b + half * 0.3), new Color("5d8796"), 1.2f);
            }
        }
        Solid(cursor, w.Length);
    }

    private void DrawStair(Stair s)
    {
        var pts = ToScreen(Shapes.Stair(s));
        DrawColoredPolygon(pts, new Color("ebe6dc"));
        DrawPolyline([.. pts, pts[0]], new Color(WallInk, 0.6f), 1);
        var run = (s.End - s.Start).Length;
        var dir = (s.End - s.Start).Normalized;
        var normal = new Point2(-dir.Y, dir.X) * (s.Width / 2);
        for (var i = 1; i < s.Steps; i++)
        {
            var c = s.Start + dir * (run * i / s.Steps);
            DrawLine(ToScreen(c - normal), ToScreen(c + normal), new Color(WallInk, 0.35f), 1);
        }
        DrawLine(ToScreen(s.Start), ToScreen(s.End), Ui.Accent, 1.5f);
        var tip = ToScreen(s.End);
        var back = (ToScreen(s.Start) - tip).Normalized() * 9;
        DrawLine(tip, tip + back.Rotated(0.5f), Ui.Accent, 1.5f);
        DrawLine(tip, tip + back.Rotated(-0.5f), Ui.Accent, 1.5f);
    }

    private void DrawFurniture(Furniture f)
    {
        var pts = ToScreen(Shapes.Furniture(f));
        DrawColoredPolygon(pts, new Color("efe9df"));
        DrawPolyline([.. pts, pts[0]], new Color(WallInk, 0.7f), 1.2f);
        // el frente del mueble (+z local) con una línea más gruesa
        DrawLine(pts[2], pts[3], new Color(WallInk, 0.9f), 2.2f);
        var size = Math.Min(f.Width, f.Depth) * _scale;
        if (size < 26) return;
        var name = Catalog.Item(f.CatalogId)?.Name ?? f.CatalogId;
        var c = ToScreen(f.Position);
        DrawString(Font, c + new Vector2(-60, 4), name.Split(' ')[0], HorizontalAlignment.Center, 120, 10, new Color(Ui.Ink, 0.65f));
    }

    /// <summary>Contorno de una entidad (selección propia, ajena o lo que está bajo el cursor).</summary>
    private void Outline(Level level, string id, Color color, float width)
    {
        Point2[]? shape = null;
        if (level.Walls.FirstOrDefault(w => w.Id == id) is { } wall)
        {
            shape = Shapes.Wall(wall);
            if (color == Ui.Accent)
                foreach (var p in new[] { wall.Start, wall.End })
                {
                    var s = ToScreen(p);
                    DrawRect(new Rect2(s - new Vector2(5, 5), new Vector2(10, 10)), Colors.White);
                    DrawRect(new Rect2(s - new Vector2(5, 5), new Vector2(10, 10)), Ui.Accent, false, 2);
                }
        }
        else if (level.Walls.SelectMany(w => w.OpeningsOrEmpty.Select(o => (w, o))).FirstOrDefault(x => x.o.Id == id) is { w: not null } wo)
        {
            var (a, b) = Shapes.Opening(wo.w, wo.o);
            var dir = wo.w.Direction;
            shape = Shapes.Rect((a + b) * 0.5, wo.o.Width, wo.w.Thickness + 0.1, Math.Atan2(dir.Y, dir.X));
        }
        else if (level.Furniture.FirstOrDefault(f => f.Id == id) is { } f) shape = Shapes.Furniture(f);
        else if (level.Columns.FirstOrDefault(c => c.Id == id) is { } c) shape = Shapes.Column(c);
        else if (level.Stairs.FirstOrDefault(s => s.Id == id) is { } st) shape = Shapes.Stair(st);
        else if (level.Rooms.FirstOrDefault(r => r.Id == id) is { } r) shape = [.. r.Polygon];
        if (shape is null || shape.Length < 2) return;
        var pts = ToScreen(shape);
        DrawPolyline([.. pts, pts[0]], color, width, true);
    }

    private void DrawFooter()
    {
        // escala gráfica de 1 m y posición del cursor
        var y = Size.Y - 22;
        var meter = _scale >= 30 ? 1f : 5f;
        DrawLine(new Vector2(20, y), new Vector2(20 + meter * _scale, y), Ui.Ink, 2);
        DrawString(Font, new Vector2(24 + meter * _scale, y + 4), $"{meter} m", HorizontalAlignment.Left, -1, 11, Ui.Muted);
        DrawString(Font, new Vector2(20, y - 10), $"x {Cursor.X.ToString("0.00", Es)} · y {Cursor.Y.ToString("0.00", Es)}   {_tool.Hint}", HorizontalAlignment.Left, -1, 11, Ui.Muted);
    }

    /// <summary>Texto de medida con fondo, para cotas vivas de las herramientas.</summary>
    public void Tag(Vector2 at, string text, Color? color = null)
    {
        var size = Font.GetStringSize(text, HorizontalAlignment.Left, -1, 12);
        var box = new Rect2(at - new Vector2(size.X / 2 + 6, size.Y / 2 + 3), size + new Vector2(12, 6));
        DrawRect(box, new Color(Ui.Ink, 0.85f));
        DrawString(Font, box.Position + new Vector2(6, size.Y - 1), text, HorizontalAlignment.Left, -1, 12, color ?? Ui.Paper);
    }

    public static string Meters(double v) => $"{v.ToString("0.00", Es)} m";
}
