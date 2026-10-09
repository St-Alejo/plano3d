"""Configuración común de las pruebas."""

import os

# Las pruebas nunca llaman a la API de Claude (costo y red): aunque backend/.env tenga
# la clave, el lector de Claude queda apagado. Sus pruebas usan un cliente falso.
os.environ["PLANO3D_CLAUDE"] = "0"
# La red de muros va activada por defecto; las pruebas usan la CV clásica sola (o una red
# falsa inyectada) para no depender del modelo publicado.
os.environ["PLANO3D_SEG_MODEL"] = "0"
