using System.Text.Json.Nodes;
using Plano3D.Core.Json;
using Plano3D.Core.Ops;
using Xunit;

namespace Plano3D.Core.Tests;

/// <summary>Los mismos casos que pasan pytest y vitest (backend/tests/fixtures/ops/cases.json).</summary>
public class OpsContractTests
{
    private static readonly JsonObject Cases = (JsonObject)Fixture.Load("ops-cases.json");

    private static IEnumerable<object[]> With(string check) =>
        ((JsonArray)Cases["cases"]!).OfType<JsonObject>()
            .Where(c => ((JsonArray)c["check"]!).Any(x => (string?)x == check))
            .Select(c => new object[] { (string)c["name"]! });

    public static IEnumerable<object[]> ApplyCases => With("apply");
    public static IEnumerable<object[]> DiffCases => With("diff");
    public static IEnumerable<object[]> ErrorCases =>
        ((JsonArray)Cases["errors"]!).OfType<JsonObject>().Select(c => new object[] { (string)c["name"]! });

    private static JsonObject Case(string section, string name) =>
        ((JsonArray)Cases[section]!).OfType<JsonObject>().Single(c => (string?)c["name"] == name);

    private static void AssertSame(JsonNode? expected, JsonNode? actual) =>
        Assert.True(
            JsonUtil.JsonEquals(JsonUtil.Canonical(expected), JsonUtil.Canonical(actual)),
            $"esperado:\n{expected?.ToJsonString()}\nobtenido:\n{actual?.ToJsonString()}");

    [Theory]
    [MemberData(nameof(ApplyCases))]
    public void Apply(string name)
    {
        var c = Case("cases", name);
        var result = ModelOps.Apply((JsonObject)c["before"]!.DeepClone(), (JsonArray)c["ops"]!.DeepClone());
        AssertSame(c["after"], result);
    }

    [Theory]
    [MemberData(nameof(DiffCases))]
    public void Diff(string name)
    {
        var c = Case("cases", name);
        var ops = ModelOps.Diff((JsonObject)c["before"]!, (JsonObject)c["after"]!);
        AssertSame(c["ops"], new JsonArray(ops.Select(o => (JsonNode)o.DeepClone()).ToArray()));
    }

    [Theory]
    [MemberData(nameof(ErrorCases))]
    public void Rejects(string name)
    {
        var c = Case("errors", name);
        Assert.Throws<InvalidOpException>(() => ModelOps.Apply((JsonObject)c["before"]!.DeepClone(), (JsonArray)c["ops"]!.DeepClone()));
    }

    [Fact]
    public void HouseCopyHasNoChanges()
    {
        var house = Fixture.House();
        Assert.Empty(ModelOps.Diff(house, (JsonObject)house.DeepClone()));
    }

    [Fact]
    public void HouseRoundTripMovingWallAndDeletingRoom()
    {
        var house = Fixture.House();
        var edited = (JsonObject)house.DeepClone();
        var level = (JsonObject)((JsonArray)edited["levels"]!)[1]!;
        var wall = (JsonObject)((JsonArray)level["walls"]!)[0]!;
        wall["end"]!["x"] = JsonUtil.AsDouble((JsonValue)wall["end"]!["x"]!) + 0.25;
        ((JsonArray)level["rooms"]!).RemoveAt(0);

        var ops = ModelOps.Diff(house, edited);

        Assert.Equal(["del room", "put wall"], ops.Select(o => $"{(string)o["t"]!} {(string)o["k"]!}").Order());
        Assert.Empty(ModelOps.Diff(ModelOps.Apply(house, new JsonArray(ops.Select(o => (JsonNode)o.DeepClone()).ToArray())), edited));
    }

    [Fact]
    public void ApplyDoesNotTouchTheOriginal()
    {
        var house = Fixture.House();
        var before = house.ToJsonString();
        var levelId = (string)house["levels"]![0]!["id"]!;
        ModelOps.Apply(house, new JsonArray(new JsonObject { ["t"] = "del", ["k"] = "level", ["id"] = levelId }));
        Assert.Equal(before, house.ToJsonString());
    }
}
