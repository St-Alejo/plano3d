"""Azure Blob Storage: archivos de los proyectos y copia del estado de la demo (ADR-020).

Usa el cliente síncrono de ``azure-storage-blob`` en un hilo (el asíncrono exige aiohttp,
que la API no necesita para nada más). El contenedor se crea la primera vez.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import BlobServiceClient, ContainerClient, ContentSettings

from plano3d.application.ports import FileStorage, StateSnapshotStore

# el SDK registra cada petición HTTP en INFO: en los registros solo interesan los problemas
logging.getLogger("azure").setLevel(logging.WARNING)


class _Blobs:
    def __init__(self, connection_string: str, container: str) -> None:
        if not connection_string:
            raise ValueError("Falta PLANO3D_BLOB_CONNECTION_STRING")
        self._service = BlobServiceClient.from_connection_string(connection_string)
        self._name = container
        self._ready = False
        self._guard = threading.Lock()

    def container(self) -> ContainerClient:
        client = self._service.get_container_client(self._name)
        with self._guard:
            if not self._ready:
                with contextlib.suppress(ResourceExistsError):
                    client.create_container()
                self._ready = True
        return client


class BlobFileStorage(FileStorage):
    def __init__(self, connection_string: str, container: str, prefix: str = "files/") -> None:
        self._blobs = _Blobs(connection_string, container)
        self._prefix = prefix

    def _put(self, key: str, data: bytes, content_type: str) -> None:
        self._blobs.container().upload_blob(
            self._prefix + key,
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )

    def _get(self, key: str) -> bytes:
        try:
            return self._blobs.container().download_blob(self._prefix + key).readall()
        except ResourceNotFoundError as exc:
            raise FileNotFoundError(key) from exc

    def _delete(self, key: str) -> None:
        with contextlib.suppress(ResourceNotFoundError):
            self._blobs.container().delete_blob(self._prefix + key)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await asyncio.to_thread(self._put, key, data, content_type)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._get, key)

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._delete, key)


class BlobSnapshotStore(StateSnapshotStore):
    def __init__(
        self, connection_string: str, container: str, blob_name: str = "state.json.gz"
    ) -> None:
        self._blobs = _Blobs(connection_string, container)
        self._blob = blob_name

    def _load(self) -> bytes | None:
        try:
            return self._blobs.container().download_blob(self._blob).readall()
        except ResourceNotFoundError:
            return None

    def _save(self, data: bytes) -> None:
        self._blobs.container().upload_blob(
            self._blob,
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type="application/gzip"),
        )

    async def load(self) -> bytes | None:
        return await asyncio.to_thread(self._load)

    async def save(self, data: bytes) -> None:
        await asyncio.to_thread(self._save, data)
