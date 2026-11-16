using Godot;

namespace Plano3D.App;

/// <summary>Colores y piezas de interfaz con la identidad de la web («Obra limpia»).</summary>
public static class Ui
{
    public static readonly Color Paper = new("f4f1ea");
    public static readonly Color Surface = new("fbfaf7");
    public static readonly Color Ink = new("1f1d1a");
    public static readonly Color Muted = new("6b665e");
    public static readonly Color Line = new("d9d3c7");
    public static readonly Color Accent = new("a84b26");
    public static readonly Color AccentHover = new("8f3d1e");
    public static readonly Color Live = new("2b8a3e");
    public static readonly Color Danger = new("c92a2a");

    /// <summary>Mismos colores por persona que la web (<c>peerColor</c> en collabStore.ts).</summary>
    private static readonly Color[] PeerPalette = [new("d9480f"), new("1971c2"), new("2b8a3e"), new("ae3ec9"), new("e67700"), new("0c8599")];

    public static Color PeerColor(string id)
    {
        uint h = 0;
        foreach (var ch in id) h = unchecked(h * 31 + ch);
        return PeerPalette[h % PeerPalette.Length];
    }

    public static StyleBoxFlat Box(Color bg, int radius = 10, Color? border = null, int pad = 14)
    {
        var sb = new StyleBoxFlat { BgColor = bg };
        sb.SetCornerRadiusAll(radius);
        sb.SetContentMarginAll(pad);
        if (border is { } b)
        {
            sb.BorderColor = b;
            sb.SetBorderWidthAll(1);
        }
        return sb;
    }

    public static Theme MakeTheme()
    {
        var t = new Theme { DefaultFontSize = 15 };
        t.SetColor("font_color", "Label", Ink);

        StyleBoxFlat Btn(Color bg, Color border) => Box(bg, 999, border, 10);
        foreach (var (state, bg) in new[] { ("normal", Surface), ("hover", Paper), ("pressed", Line), ("disabled", Surface), ("focus", Surface) })
        {
            var sb = Btn(bg, state == "focus" ? Accent : Line);
            sb.ContentMarginLeft = sb.ContentMarginRight = 18;
            if (state == "focus") sb.DrawCenter = false;
            t.SetStylebox(state, "Button", sb);
        }
        t.SetColor("font_color", "Button", Ink);
        t.SetColor("font_hover_color", "Button", Ink);
        t.SetColor("font_pressed_color", "Button", Ink);
        t.SetColor("font_disabled_color", "Button", Muted);

        t.SetTypeVariation("PrimaryButton", "Button");
        foreach (var (state, bg) in new[] { ("normal", Accent), ("hover", AccentHover), ("pressed", AccentHover), ("disabled", new Color("d4a593")) })
        {
            var sb = Btn(bg, bg);
            sb.ContentMarginLeft = sb.ContentMarginRight = 22;
            t.SetStylebox(state, "PrimaryButton", sb);
        }
        foreach (var c in new[] { "font_color", "font_hover_color", "font_pressed_color", "font_disabled_color", "font_focus_color" })
            t.SetColor(c, "PrimaryButton", Paper);

        t.SetTypeVariation("FlatButton", "Button");
        foreach (var state in new[] { "normal", "hover", "pressed", "focus" })
        {
            var sb = Box(state == "hover" ? Paper : Colors.Transparent, 8, null, 8);
            t.SetStylebox(state, "FlatButton", sb);
        }

        var field = Box(Surface, 10, Line, 10);
        t.SetStylebox("normal", "LineEdit", field);
        t.SetStylebox("focus", "LineEdit", Box(Surface, 10, Accent, 10));
        t.SetColor("font_color", "LineEdit", Ink);
        t.SetColor("font_placeholder_color", "LineEdit", Muted);
        t.SetColor("caret_color", "LineEdit", Accent);

        t.SetStylebox("normal", "OptionButton", Box(Surface, 10, Line, 8));
        t.SetStylebox("hover", "OptionButton", Box(Paper, 10, Line, 8));
        t.SetStylebox("pressed", "OptionButton", Box(Paper, 10, Accent, 8));
        t.SetColor("font_color", "OptionButton", Ink);

        t.SetStylebox("panel", "PanelContainer", Box(Surface, 14, Line, 16));
        t.SetConstant("separation", "VBoxContainer", 10);
        t.SetConstant("separation", "HBoxContainer", 10);
        return t;
    }

    public static Label Text(string text, int size = 15, Color? color = null, bool wrap = false)
    {
        var l = new Label { Text = text };
        if (size != 15) l.AddThemeFontSizeOverride("font_size", size);
        if (color is { } c) l.AddThemeColorOverride("font_color", c);
        if (wrap) l.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        return l;
    }

    public static Button Primary(string text) => new() { Text = text, ThemeTypeVariation = "PrimaryButton", CustomMinimumSize = new Vector2(0, 44) };

    public static Button Secondary(string text) => new() { Text = text, CustomMinimumSize = new Vector2(0, 40) };

    public static Button Flat(string text) => new() { Text = text, ThemeTypeVariation = "FlatButton" };

    public static MarginContainer Pad(Control child, int h, int v)
    {
        var m = new MarginContainer();
        m.AddThemeConstantOverride("margin_left", h);
        m.AddThemeConstantOverride("margin_right", h);
        m.AddThemeConstantOverride("margin_top", v);
        m.AddThemeConstantOverride("margin_bottom", v);
        m.AddChild(child);
        return m;
    }

    public static Control Fill(Control c)
    {
        c.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        return c;
    }
}
