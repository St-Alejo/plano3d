"""U-Net pequeña para segmentar muros (entrada: gris 1 canal; salida: logit de muro).

~1,3 M parámetros: entrena en CPU en minutos y en producción corre con onnxruntime sin
PyTorch. Es totalmente convolucional: acepta cualquier tamaño múltiplo de 16.
"""

from __future__ import annotations

import torch
from torch import nn


def _block(cin: int, cout: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False),
        nn.BatchNorm2d(cout),
        nn.ReLU(inplace=True),
    )


class WallUNet(nn.Module):
    def __init__(self, base: int = 16) -> None:
        super().__init__()
        c = [base, base * 2, base * 4, base * 8, base * 8]
        self.down = nn.ModuleList([_block(1, c[0])] + [_block(c[i], c[i + 1]) for i in range(4)])
        self.pool = nn.MaxPool2d(2)
        self.up = nn.ModuleList(
            [nn.ConvTranspose2d(c[i + 1], c[i], 2, stride=2) for i in reversed(range(4))]
        )
        self.merge = nn.ModuleList([_block(c[i] * 2, c[i]) for i in reversed(range(4))])
        self.head = nn.Conv2d(c[0], 1, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        skips = []
        for i, block in enumerate(self.down):
            x = block(x)
            if i < 4:
                skips.append(x)
                x = self.pool(x)
        for up, merge, skip in zip(self.up, self.merge, reversed(skips), strict=True):
            x = merge(torch.cat([up(x), skip], dim=1))
        return self.head(x)
