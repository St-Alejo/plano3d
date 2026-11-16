using System.Buffers.Binary;
using System.Text;
using System.Text.Json.Nodes;

namespace Plano3D.Core.Rendering;

/// <summary>
/// Retoca un GLB ya escrito: los nodos cuyo nombre trae datos (<see cref="BlenderNaming.EncodeNode"/>)
/// quedan con su nombre limpio y esos datos como <c>extras</c> del glTF. El binario (mallas)
/// no se toca: solo se reescribe el bloque JSON.
/// </summary>
public static class GlbExtras
{
    private const uint Magic = 0x46546C67; // "glTF"
    private const uint JsonChunk = 0x4E4F534A; // "JSON"

    /// <summary>
    /// Cuántos nodos recibieron extras y el GLB nuevo. <paramref name="materialNames"/> devuelve
    /// a cada material su nombre real (el exportador de Godot cambia «:» por «_» y numera los
    /// repetidos, así que se exporta con una ficha segura y aquí se reemplaza).
    /// </summary>
    public static (byte[] Glb, int Tagged) Apply(byte[] glb, IReadOnlyDictionary<string, string>? materialNames = null)
    {
        var (json, bin) = Read(glb);
        if (materialNames is not null)
            foreach (var mat in (json["materials"] as JsonArray ?? []).OfType<JsonObject>())
                if ((string?)mat["name"] is { } token && materialNames.TryGetValue(token, out var real))
                    mat["name"] = real;
        var tagged = 0;
        foreach (var node in (json["nodes"] as JsonArray ?? []).OfType<JsonObject>())
        {
            if ((string?)node["name"] is not { } name || !name.Contains("~~", StringComparison.Ordinal)) continue;
            var (clean, extras) = BlenderNaming.DecodeNode(name);
            node["name"] = clean;
            var target = node["extras"] as JsonObject ?? new JsonObject();
            foreach (var (k, v) in extras) target[k] = v;
            node["extras"] = target;
            tagged++;
        }
        return (Write(json, bin), tagged);
    }

    public static (JsonObject Json, byte[]? Bin) Read(byte[] glb)
    {
        if (glb.Length < 20 || BinaryPrimitives.ReadUInt32LittleEndian(glb) != Magic)
            throw new InvalidDataException("No es un GLB");
        var jsonLen = (int)BinaryPrimitives.ReadUInt32LittleEndian(glb.AsSpan(12));
        if (BinaryPrimitives.ReadUInt32LittleEndian(glb.AsSpan(16)) != JsonChunk)
            throw new InvalidDataException("El GLB no empieza con su JSON");
        var json = (JsonObject)JsonNode.Parse(Encoding.UTF8.GetString(glb, 20, jsonLen).TrimEnd(' ', '\0'))!;
        byte[]? bin = null;
        var at = 20 + jsonLen;
        if (at + 8 <= glb.Length)
        {
            var binLen = (int)BinaryPrimitives.ReadUInt32LittleEndian(glb.AsSpan(at));
            bin = glb.AsSpan(at + 8, binLen).ToArray();
        }
        return (json, bin);
    }

    public static byte[] Write(JsonObject json, byte[]? bin)
    {
        var text = Encoding.UTF8.GetBytes(json.ToJsonString());
        var jsonLen = Pad(text.Length);
        var binLen = bin is null ? 0 : Pad(bin.Length);
        var total = 12 + 8 + jsonLen + (bin is null ? 0 : 8 + binLen);
        var outp = new byte[total];
        var s = outp.AsSpan();
        BinaryPrimitives.WriteUInt32LittleEndian(s, Magic);
        BinaryPrimitives.WriteUInt32LittleEndian(s[4..], 2);
        BinaryPrimitives.WriteUInt32LittleEndian(s[8..], (uint)total);
        BinaryPrimitives.WriteUInt32LittleEndian(s[12..], (uint)jsonLen);
        BinaryPrimitives.WriteUInt32LittleEndian(s[16..], JsonChunk);
        text.CopyTo(s[20..]);
        s.Slice(20 + text.Length, jsonLen - text.Length).Fill((byte)' ');
        if (bin is not null)
        {
            var at = 20 + jsonLen;
            BinaryPrimitives.WriteUInt32LittleEndian(s[at..], (uint)binLen);
            BinaryPrimitives.WriteUInt32LittleEndian(s[(at + 4)..], 0x004E4942); // "BIN\0"
            bin.CopyTo(s[(at + 8)..]); // el relleno del binario va en ceros
        }
        return outp;
    }

    private static int Pad(int n) => (n + 3) & ~3;
}
