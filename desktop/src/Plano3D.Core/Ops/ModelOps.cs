using System.Text.Json.Nodes;
using Plano3D.Core.Json;

namespace Plano3D.Core.Ops;

/// <summary>El cambio no se puede aplicar a este modelo (el servidor también lo rechazaría).</summary>
public sealed class InvalidOpException(string message) : Exception(message);

/// <summary>
/// Cambios por entidad («ops», ADR-019): el idioma común de la edición en vivo.
///
/// Port fiel de <c>frontend/src/domain/ops.ts</c> y <c>backend/.../application/ops.py</c>;
/// lo garantizan los casos de <c>Fixtures/ops-cases.json</c>, copiados del backend con
/// <c>python scripts/export_openapi.py</c>. El modelo viaja como JSON (JsonObject) para no
/// perder campos que este cliente todavía no conoce.
/// </summary>
public static class ModelOps
{
    public static readonly IReadOnlyDictionary<string, string> Collections = new Dictionary<string, string>
    {
        ["wall"] = "walls",
        ["room"] = "rooms",
        ["column"] = "columns",
        ["stair"] = "stairs",
        ["dimension"] = "dimensions",
        ["label"] = "labels",
        ["furniture"] = "furniture",
    };

    /// <summary>Orden en que se comparan las colecciones (el mismo que en la web).</summary>
    private static readonly string[] Kinds = ["wall", "room", "column", "stair", "dimension", "label", "furniture"];

    public static readonly string[] ModelFields = ["scale", "facade", "facade_custom", "source_image"];
    private static readonly string[] LevelProps = ["id", "name", "elevation", "height"];

    /// <summary>Campos de solo salida que recalcula el servidor: no cuentan como cambio.</summary>
    private static readonly Dictionary<string, string[]> Derived = new()
    {
        ["wall"] = ["length"],
        ["room"] = ["area", "centroid"],
        ["stair"] = ["tread"],
        ["dimension"] = ["measured"],
    };

    // ------------------------------------------------------------------ aplicar
    /// <summary>Copia del modelo con los cambios aplicados en orden. Borrar algo que ya no existe no es error.</summary>
    public static JsonObject Apply(JsonObject model, IEnumerable<JsonNode?> ops)
    {
        var outModel = (JsonObject)model.DeepClone();
        if (outModel["levels"] is not JsonArray levels)
        {
            levels = new JsonArray();
            outModel["levels"] = levels;
        }
        foreach (var op in ops)
        {
            if (op is not JsonObject o) throw new InvalidOpException("Cada cambio debe ser un objeto");
            ApplyOne(outModel, levels, o);
        }
        return outModel;
    }

    private static void ApplyOne(JsonObject model, JsonArray levels, JsonObject op)
    {
        var t = op.Str("t");
        var k = op.Str("k");
        if (t is not ("put" or "del" or "set") || k is null || !(k is "model" or "level" || Collections.ContainsKey(k)))
            throw new InvalidOpException($"Cambio desconocido: t={t}, k={k}");
        if (k == "model")
        {
            var f = op.Str("f");
            if (t != "set" || f is null || !ModelFields.Contains(f))
                throw new InvalidOpException($"Solo se puede hacer set de {string.Join(", ", ModelFields)}");
            model[f] = op["v"]?.DeepClone();
            return;
        }
        if (t == "set") throw new InvalidOpException("set solo aplica al modelo");
        var id = op.Str("id");
        if (string.IsNullOrEmpty(id)) throw new InvalidOpException($"El cambio {t} {k} necesita id");
        if (k == "level")
        {
            ApplyLevel(levels, t, id, op["v"]);
            return;
        }
        var levelId = op.Str("level");
        var level = levels.OfType<JsonObject>().FirstOrDefault(lv => lv.Str("id") == levelId)
            ?? throw new InvalidOpException($"El nivel \"{levelId}\" no existe");
        var key = Collections[k];
        var list = level.Items(key);
        if (t == "del")
        {
            var kept = new JsonArray();
            foreach (var it in list)
                if (it.Str("id") != id) kept.Add(it?.DeepClone());
            level[key] = kept;
            return;
        }
        if (op["v"] is not JsonObject v || v.Str("id") != id)
            throw new InvalidOpException($"put {k} {id}: v debe ser la entidad con el mismo id");
        var next = new JsonArray();
        var replaced = false;
        foreach (var it in list)
        {
            if (!replaced && it.Str("id") == id)
            {
                next.Add(v.DeepClone());
                replaced = true;
            }
            else next.Add(it?.DeepClone());
        }
        if (!replaced) next.Add(v.DeepClone());
        level[key] = next;
    }

    private static void ApplyLevel(JsonArray levels, string t, string id, JsonNode? value)
    {
        if (t == "del")
        {
            for (var i = levels.Count - 1; i >= 0; i--)
                if (levels[i].Str("id") == id) levels.RemoveAt(i);
            return;
        }
        if (value is not JsonObject v || v.Str("id") != id)
            throw new InvalidOpException($"put level {id}: v debe ser el nivel con el mismo id");
        var lv = levels.OfType<JsonObject>().FirstOrDefault(l => l.Str("id") == id);
        if (lv is null)
        {
            lv = new JsonObject();
            foreach (var p in LevelProps)
                if (v.TryGetPropertyValue(p, out var x)) lv[p] = x?.DeepClone();
            lv["walls"] = new JsonArray();
            lv["rooms"] = new JsonArray();
            levels.Add(lv);
            return;
        }
        foreach (var p in LevelProps)
            if (p != "id") lv.Remove(p);
        foreach (var p in LevelProps)
            if (v.TryGetPropertyValue(p, out var x)) lv[p] = x?.DeepClone();
    }

    // ------------------------------------------------------------------ comparar
    /// <summary>
    /// Cambios mínimos de <paramref name="before"/> a <paramref name="after"/>, en un orden que
    /// siempre se puede aplicar: campos del modelo, niveles nuevos o cambiados, entidades y al
    /// final niveles borrados.
    /// </summary>
    public static List<JsonObject> Diff(JsonObject before, JsonObject after)
    {
        var ops = new List<JsonObject>();
        foreach (var f in ModelFields)
        {
            if (!JsonUtil.JsonEquals(JsonUtil.Canonical(before[f]), JsonUtil.Canonical(after[f])))
                ops.Add(new JsonObject { ["t"] = "set", ["k"] = "model", ["f"] = f, ["v"] = after[f]?.DeepClone() });
        }
        var oldLevels = LevelsById(before);
        var newLevels = LevelsById(after);
        foreach (var (id, lv) in newLevels)
        {
            if (!oldLevels.TryGetValue(id, out var old) || !JsonUtil.JsonEquals(LevelPropsOf(old), LevelPropsOf(lv)))
                ops.Add(new JsonObject { ["t"] = "put", ["k"] = "level", ["id"] = id, ["v"] = LevelPropsOf(lv) });
        }
        foreach (var (id, lv) in newLevels)
            ops.AddRange(DiffLevel(id, oldLevels.GetValueOrDefault(id) ?? new JsonObject(), lv));
        foreach (var id in oldLevels.Keys)
            if (!newLevels.ContainsKey(id)) ops.Add(new JsonObject { ["t"] = "del", ["k"] = "level", ["id"] = id });
        return ops;
    }

    private static List<KeyValuePair<string, JsonObject>> LevelsByIdList(JsonObject model) =>
        model.Items("levels").OfType<JsonObject>().Select(lv => KeyValuePair.Create(lv.Str("id") ?? "", lv)).ToList();

    private static OrderedLevels LevelsById(JsonObject model) => new(LevelsByIdList(model));

    private static JsonObject LevelPropsOf(JsonObject level)
    {
        var o = new JsonObject();
        foreach (var p in LevelProps)
            if (level.TryGetPropertyValue(p, out var v)) o[p] = v?.DeepClone();
        return (JsonObject)JsonUtil.Canonical(o)!;
    }

    private static JsonObject CanonicalEntity(string kind, JsonNode? value)
    {
        var o = (JsonObject)JsonUtil.Canonical(value)!;
        if (Derived.TryGetValue(kind, out var keys))
            foreach (var key in keys) o.Remove(key);
        return o;
    }

    private static IEnumerable<JsonObject> DiffLevel(string level, JsonObject before, JsonObject after)
    {
        foreach (var k in Kinds)
        {
            var key = Collections[k];
            var old = new Dictionary<string, JsonNode?>();
            foreach (var it in before.Items(key)) old[it.Str("id") ?? ""] = it;
            var next = after.Items(key);
            var nextIds = next.Select(it => it.Str("id")).ToHashSet();
            foreach (var id in old.Keys)
                if (!nextIds.Contains(id)) yield return new JsonObject { ["t"] = "del", ["k"] = k, ["level"] = level, ["id"] = id };
            foreach (var it in next)
            {
                var id = it.Str("id") ?? "";
                var v = CanonicalEntity(k, it);
                if (!old.TryGetValue(id, out var prev) || !JsonUtil.JsonEquals(CanonicalEntity(k, prev), v))
                    yield return new JsonObject { ["t"] = "put", ["k"] = k, ["level"] = level, ["id"] = id, ["v"] = v };
            }
        }
    }

    /// <summary>Diccionario que recuerda el orden de inserción (los niveles se comparan en orden).</summary>
    private sealed class OrderedLevels(List<KeyValuePair<string, JsonObject>> items) : IEnumerable<KeyValuePair<string, JsonObject>>
    {
        private readonly Dictionary<string, JsonObject> _byId = items.GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.First().Value);
        public IEnumerable<string> Keys => items.Select(p => p.Key);
        public bool ContainsKey(string id) => _byId.ContainsKey(id);
        public bool TryGetValue(string id, out JsonObject value) => _byId.TryGetValue(id, out value!);
        public JsonObject? GetValueOrDefault(string id) => _byId.GetValueOrDefault(id);
        public IEnumerator<KeyValuePair<string, JsonObject>> GetEnumerator() => items.GetEnumerator();
        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
