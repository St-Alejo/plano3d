"""Almacenamiento S3-compatible: SeaweedFS en local, AWS S3 o Cloudflare R2 al desplegar."""

from __future__ import annotations

import aioboto3
from botocore.exceptions import ClientError

from plano3d.application.ports import FileStorage


class S3FileStorage(FileStorage):
    def __init__(
        self,
        bucket: str,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
    ) -> None:
        self._bucket = bucket
        self._session = aioboto3.Session()
        self._kwargs = {
            "endpoint_url": endpoint_url,
            "aws_access_key_id": access_key,
            "aws_secret_access_key": secret_key,
            "region_name": region,
        }

    async def ensure_bucket(self) -> None:
        async with self._session.client("s3", **self._kwargs) as s3:
            try:
                await s3.head_bucket(Bucket=self._bucket)
            except ClientError:
                await s3.create_bucket(Bucket=self._bucket)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        async with self._session.client("s3", **self._kwargs) as s3:
            await s3.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    async def get(self, key: str) -> bytes:
        async with self._session.client("s3", **self._kwargs) as s3:
            try:
                obj = await s3.get_object(Bucket=self._bucket, Key=key)
            except ClientError as exc:
                raise FileNotFoundError(key) from exc
            async with obj["Body"] as stream:
                return bytes(await stream.read())

    async def delete(self, key: str) -> None:
        async with self._session.client("s3", **self._kwargs) as s3:
            await s3.delete_object(Bucket=self._bucket, Key=key)
