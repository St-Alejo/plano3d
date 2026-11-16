using Xunit;

namespace Plano3D.Infrastructure.Tests;

/// <summary>
/// La app lleva una copia de <c>arquitectura.py</c> (cada cliente se publica en su repositorio),
/// pero el script es uno solo: la copia debe ser igual a la de la web. Si cambia la de la web,
/// copiarla a <c>desktop/app/blender/</c>.
/// </summary>
public class BlenderScriptCopyTests
{
    private const string WebPath = "src/features/viewer3d/export/blender/arquitectura.py";

    [Fact]
    public void LaCopiaDeLaAppEsIgualALaDeLaWeb()
    {
        var desktop = new DirectoryInfo(AppContext.BaseDirectory);
        while (desktop is not null && !File.Exists(Path.Combine(desktop.FullName, "app", "blender", "arquitectura.py")))
            desktop = desktop.Parent;
        Assert.NotNull(desktop);
        var copy = File.ReadAllText(Path.Combine(desktop.FullName, "app", "blender", "arquitectura.py"));

        // en el monorepo la web está en ../frontend; en el repositorio publicado, en la raíz
        var web = new[] { Path.Combine(desktop.FullName, "..", "frontend", WebPath), Path.Combine(desktop.FullName, "..", WebPath) }
            .FirstOrDefault(File.Exists);
        if (web is null) return; // solo la app (sin la web al lado): nada que comparar
        Assert.True(Normalize(File.ReadAllText(web)) == Normalize(copy), $"desktop/app/blender/arquitectura.py quedó distinto de {web}: cópialo de nuevo");
    }

    private static string Normalize(string s) => s.Replace("\r\n", "\n");
}
