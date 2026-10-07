"""Entrena la U-Net de muros con planos sintéticos y la exporta a ONNX.

Uso (desde backend/, con el extra ``train``)::

    python -m ml.train_seg --samples 3000 --epochs 6 --out models/plan-seg-v1.onnx

Los planos reales (tests/real) NUNCA se usan para entrenar: son el examen. La ficha
``<modelo>.json`` guarda los datos de entrenamiento y las métricas de validación.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.model import WallUNet
from ml.synth import sample

CACHE = Path(__file__).parent / "data"


def dataset(n: int, offset: int, tile: int) -> tuple[np.ndarray, np.ndarray]:
    path = CACHE / f"synth_v2_{offset}_{n}_{tile}.npz"
    if path.exists():
        d = np.load(path)
        return d["x"], d["y"]
    xs, ys = zip(*(sample(offset + i, tile) for i in range(n)), strict=True)
    x, y = np.stack(xs), np.stack(ys)
    CACHE.mkdir(exist_ok=True)
    np.savez_compressed(path, x=x, y=y)
    return x, y


def to_tensor(x: np.ndarray, y: np.ndarray) -> tuple[torch.Tensor, torch.Tensor]:
    xt = torch.from_numpy(x).float().div(255.0).unsqueeze(1)
    yt = torch.from_numpy((y > 0).astype(np.float32)).unsqueeze(1)
    return 1.0 - xt, yt  # tinta = 1: mismo convenio para todos los estilos


def dice_loss(logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    p = torch.sigmoid(logits)
    inter = (p * target).sum((2, 3))
    return (1 - (2 * inter + 1) / (p.sum((2, 3)) + target.sum((2, 3)) + 1)).mean()


def iou(logits: torch.Tensor, target: torch.Tensor) -> float:
    p = logits > 0
    t = target > 0.5
    return float((p & t).sum() / max(1, int((p | t).sum())))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=3000)
    ap.add_argument("--val", type=int, default=200)
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--tile", type=int, default=256)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--out", default="models/plan-seg-v1.onnx")
    args = ap.parse_args()
    torch.manual_seed(0)

    t0 = time.time()
    x, y = dataset(args.samples, 0, args.tile)
    xv, yv = dataset(args.val, 1_000_000, args.tile)  # semillas que no se entrenan
    print(f"datos: {len(x)} + {len(xv)} en {time.time() - t0:.0f} s", flush=True)
    xt, yt = to_tensor(x, y)
    xvt, yvt = to_tensor(xv, yv)

    model = WallUNet()
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    steps = args.epochs * (len(xt) // args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps)
    bce = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(3.0))
    history = []
    for epoch in range(args.epochs):
        model.train()
        perm = torch.randperm(len(xt))
        total = 0.0
        for k in range(0, len(perm) - args.batch + 1, args.batch):
            idx = perm[k : k + args.batch]
            xb, yb = xt[idx], yt[idx]
            if torch.rand(1) < 0.5:  # aumentos baratos: espejos y giros de 90°
                xb, yb = xb.flip(3), yb.flip(3)
            r = int(torch.randint(0, 4, (1,)))
            xb, yb = torch.rot90(xb, r, (2, 3)), torch.rot90(yb, r, (2, 3))
            logits = model(xb)
            loss = bce(logits, yb) + dice_loss(logits, yb)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += float(loss)
        model.eval()
        with torch.no_grad():
            val = [iou(model(xvt[k : k + 32]), yvt[k : k + 32]) for k in range(0, len(xvt), 32)]
        row = {
            "epoch": epoch + 1,
            "loss": round(total / (len(perm) // args.batch), 4),
            "val_iou": round(float(np.mean(val)), 4),
        }
        history.append(row)
        print(row, f"{time.time() - t0:.0f} s", flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    model.eval()
    torch.onnx.export(
        model,
        torch.zeros(1, 1, 256, 256),
        str(out),
        input_names=["ink"],
        output_names=["wall_logit"],
        dynamic_axes={"ink": {2: "h", 3: "w"}, "wall_logit": {2: "h", 3: "w"}},
        opset_version=17,
    )
    card = {
        "model": out.name,
        "created": datetime.now().isoformat(timespec="seconds"),
        "architecture": "WallUNet base 16 (~1,3 M parámetros)",
        "input": "gris normalizado, tinta = 1 (1 - gris/255), alto y ancho múltiplos de 16",
        "output": "logit de muro por píxel",
        "data": {"synthetic_v2": args.samples, "validation": args.val, "tile": args.tile},
        "real_plans_used_for_training": False,
        "history": history,
    }
    out.with_suffix(".json").write_text(
        json.dumps(card, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("exportado", out)


if __name__ == "__main__":
    main()
