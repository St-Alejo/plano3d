using System.Security.Cryptography;
using System.Text;

namespace Plano3D.Infrastructure.Api;

/// <summary>Dónde se guarda el token de refresco entre aperturas de la app.</summary>
public interface ITokenStore
{
    string? Load();
    void Save(string refreshToken);
    void Clear();
}

/// <summary>Solo en memoria (pruebas, o «no recordar sesión»).</summary>
public sealed class MemoryTokenStore : ITokenStore
{
    private string? _token;
    public string? Load() => _token;
    public void Save(string refreshToken) => _token = refreshToken;
    public void Clear() => _token = null;
}

/// <summary>
/// Archivo cifrado con DPAPI de Windows (solo lo descifra este usuario en este equipo),
/// en <c>%APPDATA%\Plano3D\sesion.bin</c>. Fuera de Windows guarda el token con permisos
/// solo del usuario.
/// </summary>
public sealed class DpapiTokenStore(string? path = null) : ITokenStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Plano3D.sesion.v1");

    private readonly string _path = path ?? System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Plano3D", "sesion.bin");

    public string? Load()
    {
        try
        {
            if (!File.Exists(_path)) return null;
            var data = File.ReadAllBytes(_path);
            if (OperatingSystem.IsWindows()) data = ProtectedData.Unprotect(data, Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(data);
        }
        catch (Exception e) when (e is IOException or CryptographicException or UnauthorizedAccessException)
        {
            return null; // copiado de otro equipo o dañado: se vuelve a entrar
        }
    }

    public void Save(string refreshToken)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(_path)!);
        var data = Encoding.UTF8.GetBytes(refreshToken);
        if (OperatingSystem.IsWindows()) data = ProtectedData.Protect(data, Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_path, data);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(_path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }

    public void Clear()
    {
        try
        {
            File.Delete(_path);
        }
        catch (IOException)
        {
        }
    }
}
